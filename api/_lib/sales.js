import crypto from 'node:crypto';
import { getAdminDb } from './firebase-admin.js';
import { BusinessError } from './errors.js';

/**
 * Genera un ID de venta determinístico basado en el tenant y la referencia externa.
 */
export function getSaleId(tenantId, externalReference) {
  return `qr-${crypto.createHash('sha256').update(`${tenantId}:${externalReference}`).digest('hex').slice(0, 40)}`;
}

/**
 * Procesa una venta de forma atómica: descuenta stock, crea el registro y marca el pago.
 *
 * REGLA QR: Si el pago ya fue aprobado por Mercado Pago (webhook o confirmación manual),
 * la venta DEBE registrarse obligatoriamente. No se lanza error por falta de stock;
 * en su lugar, el stock se descuenta igual (quedando negativo si es necesario)
 * y se marca la venta con stockWarning: true.
 */
export async function finalizeSale(tenantId, saleData, paymentId) {
  const db = getAdminDb();
  const tenantRef = db.collection('tenants').doc(tenantId);
  const saleRef = tenantRef.collection('sales').doc(saleData.id);
  const claimRef = db.collection('qr_payment_claims').doc(paymentId);

  return await db.runTransaction(async (transaction) => {
    const existingSale = await transaction.get(saleRef);
    const existingClaim = await transaction.get(claimRef);

    // Idempotencia: Si la venta ya existe, no hacemos nada
    if (existingSale.exists) return { alreadyProcessed: true, sale: existingSale.data() };

    // Si el pago ya fue reclamado por otra venta (colisión teórica), lanzamos error
    if (existingClaim.exists) throw new BusinessError('Este pago ya fue utilizado', 409);

    // 1. Cargar productos para validación y descuento de stock
    const productRefs = saleData.items.map(item => tenantRef.collection('products').doc(item.productId));
    const productSnaps = [];
    for (const pRef of productRefs) {
      productSnaps.push(await transaction.get(pRef));
    }

    let hasStockWarning = false;
    for (let i = 0; i < saleData.items.length; i++) {
      const item = saleData.items[i];
      const pSnap = productSnaps[i];

      if (!pSnap.exists) {
        throw new BusinessError(`Producto ${item.productId} no existe`);
      }

      const pData = pSnap.data();

      // Verificamos stock si el producto lo trackea
      if (item.trackStock && pData.stock !== null && pData.stock < item.quantity) {
        hasStockWarning = true;
        console.warn(`[Stock Warning] Venta ${saleData.id} forzada con stock insuficiente para ${pData.name}`);
      }
    }

    // 2. Crear documento de Venta
    const finalSale = {
      ...saleData,
      mercadoPagoPaymentId: paymentId,
      status: 'completed',
      stockWarning: hasStockWarning, // true si hubo falta de stock, false en caso contrario
      processedAt: new Date().toISOString(),
      updatedAt: new Date(),
    };

    transaction.set(saleRef, finalSale);

    // 3. Reclamar el pago (Previene que el mismo paymentId se use dos veces)
    transaction.set(claimRef, {
      saleId: saleData.id,
      tenantId,
      paymentId,
      amount: saleData.total,
      createdAt: new Date().toISOString()
    });

    // 4. Actualizar Stock
    // Se descuenta el stock de todos los items, permitiendo que el valor sea negativo.
    saleData.items.forEach((item, i) => {
      if (item.trackStock) {
        const pData = productSnaps[i].data();
        const currentStock = Number(pData.stock || 0);
        transaction.update(productRefs[i], {
          stock: currentStock - item.quantity,
          updatedAt: new Date()
        });
      }
    });

    return { alreadyProcessed: false, sale: finalSale };
  });
}
