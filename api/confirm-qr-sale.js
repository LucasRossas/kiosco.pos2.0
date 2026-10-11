import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { round2, lineTotal } from './_lib/money.js';
import { mpFetch } from './_lib/mp-token.js';
import { isStockTracked } from './_lib/stock.js';
import { BusinessError } from './_lib/errors.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const sale = req.body?.sale;
    const externalReference = String(sale?.externalReference || '').trim();
    const items = Array.isArray(sale?.items) ? sale.items : [];

    // Validar externalReference: pos-<uid>-<digitos>
    const refRegex = new RegExp(`^pos-${tenantId}-\\d+$`);
    if (!externalReference || !refRegex.test(externalReference) || items.length === 0) {
      return res.status(400).json({ error: 'Venta QR inválida' });
    }

    const db = getAdminDb();
    const tenantRef = db.collection('tenants').doc(tenantId);

    // 1. Recalcular total y validar productos (Stock check se hace en la transacción)
    const productRefs = items.map((item) => tenantRef.collection('products').doc(String(item.productId || '').trim()));
    const productSnapshots = await Promise.all(productRefs.map((ref) => ref.get()));

    if (productSnapshots.some((snapshot) => !snapshot.exists)) {
      throw new BusinessError('Uno o más productos no existen');
    }

    let calculatedTotal = 0;
    const normalizedItems = items.map((item, index) => {
      const product = productSnapshots[index].data();
      const quantity = Number(item.quantity);
      const price = Number(product.price);
      calculatedTotal += lineTotal(price, quantity);
      return {
        productId: productSnapshots[index].id,
        name: String(product.name || 'Producto'),
        quantity,
        price,
        trackStock: isStockTracked(product),
      };
    });
    calculatedTotal = round2(calculatedTotal);

    // 2. Consultar la ORDEN en Mercado Pago (Prueba de verdad)
    // Buscamos por external_reference para obtener la merchant_order
    const mpSearchRes = await mpFetch(db, tenantId,
      `https://api.mercadopago.com/merchant_orders/search?external_reference=${encodeURIComponent(externalReference)}`,
      { method: 'GET' }
    );

    if (!mpSearchRes.ok) {
      throw new Error('Error al consultar estado en Mercado Pago');
    }

    const searchData = await mpSearchRes.json();
    const order = (searchData.elements || []).find(o => o.external_reference === externalReference);

    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada en Mercado Pago' });
    }

    // Validar estado de la orden (closed = pagada en MP V2) y monto
    const isPaid = order.status === 'closed' || order.order_status === 'paid';
    const amountMatch = Math.abs(order.total_amount - calculatedTotal) < 0.01;
    const approvedPayment = (order.payments || []).find(p => p.status === 'approved');

    if (!isPaid || !amountMatch || !approvedPayment) {
      return res.status(409).json({
        error: 'La orden aún no está pagada o el monto no coincide',
        mpStatus: order.status,
        mpAmount: order.total_amount,
        expectedAmount: calculatedTotal
      });
    }

    const paymentId = String(approvedPayment.id);
    const saleId = getSaleId(tenantId, externalReference);

    const saleData = {
      id: saleId,
      shiftId: String(sale.shiftId || ''),
      cashier: String(sale.cashier || ''),
      total: calculatedTotal,
      paymentMethod: 'qr_mp',
      items: normalizedItems,
      externalReference,
      merchantOrderId: String(order.id),
      createdAt: new Date().toISOString(),
    };

    const result = await finalizeSale(tenantId, saleData, paymentId);

    // Limpiar el índice de la orden ya procesada
    await db.collection('qr_order_index').doc(externalReference).delete().catch(() => {});

    return res.status(200).json({ confirmed: true, ...result });

  } catch (error) {
    console.error('confirm-qr-sale error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: error instanceof BusinessError ? error.message : 'Error interno'
    });
  }
}
