import crypto from 'node:crypto';
import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { round2, lineTotal } from './_lib/money.js';
import { mpFetch } from './_lib/mp-token.js';

const SPECIAL_CATEGORIES = new Set(['Verdulería', 'Fiambrería', 'Carnicería', 'Panadería']);

function isTracked(product, item) {
  return item.trackStock ?? !SPECIAL_CATEGORIES.has(product.category);
}

function getSaleId(tenantId, externalReference) {
  return `qr-${crypto.createHash('sha256').update(`${tenantId}:${externalReference}`).digest('hex').slice(0, 40)}`;
}

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
    if (!externalReference || !refRegex.test(externalReference) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ error: 'Venta QR inválida' });
    }

    const db = getAdminDb();
    const tenantRef = db.collection('tenants').doc(tenantId);

    const productRefs = items.map((item) => tenantRef.collection('products').doc(String(item.productId || '').trim()));
    if (productRefs.some((ref) => ref.id.length === 0)) return res.status(400).json({ error: 'Producto inválido' });

    // Lectura inicial de productos para validación de precio y estructura
    const productSnapshots = await Promise.all(productRefs.map((ref) => ref.get()));
    if (productSnapshots.some((snapshot) => !snapshot.exists)) {
      return res.status(400).json({ error: 'Producto no encontrado' });
    }

    let calculatedTotal = 0;
    const normalizedItems = items.map((item, index) => {
      const product = productSnapshots[index].data();
      const quantity = Number(item.quantity);
      const price = Number(product.price);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
        throw new Error('Cantidad o precio inválido');
      }
      calculatedTotal += lineTotal(price, quantity);
      return {
        productId: productSnapshots[index].id,
        name: String(product.name || 'Producto'),
        quantity,
        price,
        category: product.category || 'General',
        isByWeight: Boolean(product.isByWeight),
        trackStock: isTracked(product, item),
      };
    });

    calculatedTotal = round2(calculatedTotal);

    // Consultar el pago en Mercado Pago
    const paymentSearch = await mpFetch(db, tenantId,
      `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}`,
      { method: 'GET' }
    );
    const paymentData = await paymentSearch.json();
    if (!paymentSearch.ok) {
        console.error("MP Search Error:", paymentData);
        return res.status(502).json({ error: 'Error al verificar pago' });
    }

    const payment = (paymentData.results || []).find((item) => (
      item.status === 'approved' &&
      item.external_reference === externalReference &&
      Math.abs(Number(item.transaction_amount) - calculatedTotal) < 0.01
    ));

    if (!payment) {
        return res.status(409).json({ error: 'Pago no encontrado o monto inválido' });
    }

    const saleId = getSaleId(tenantId, externalReference);
    const saleRef = tenantRef.collection('sales').doc(saleId);
    const claimRef = db.collection('qr_payment_claims').doc(String(payment.id));

    const result = await db.runTransaction(async (transaction) => {
      // 1. LECTURAS
      const existingSale = await transaction.get(saleRef);
      const existingClaim = await transaction.get(claimRef);

      const currentProducts = [];
      for (const productRef of productRefs) {
        currentProducts.push(await transaction.get(productRef));
      }

      // 2. VALIDACIONES
      if (existingSale.exists) return { idempotent: true, sale: existingSale.data() };

      if (existingClaim.exists) {
        const claimData = existingClaim.data();
        if (claimData.saleId !== saleId) {
          throw { statusCode: 409, message: 'Pago ya utilizado' };
        }
        // Si existe pero es el mismo saleId, tratamos como idempotente (aunque saleRef debería existir)
        return { idempotent: true, sale: existingSale.data() };
      }

      for (let index = 0; index < currentProducts.length; index += 1) {
        const product = currentProducts[index].data();
        const item = normalizedItems[index];
        if (item.trackStock && (product.stock === null || Number(product.stock) < item.quantity)) {
          throw { statusCode: 400, message: `Stock insuficiente para ${product.name}` };
        }
      }

      // 3. ESCRITURAS
      const safeSale = {
        id: saleId,
        shiftId: String(sale.shiftId || ''),
        cashier: String(sale.cashier || ''),
        total: calculatedTotal,
        paymentMethod: 'qr_mp',
        items: normalizedItems,
        externalReference: externalReference,
        mercadoPagoPaymentId: String(payment.id),
        createdAt: sale.createdAt || new Date().toISOString(),
        updatedAt: new Date(),
      };

      transaction.set(saleRef, safeSale);

      transaction.set(claimRef, {
        saleId: saleId,
        tenantId: tenantId,
        createdAt: new Date().toISOString()
      });

      normalizedItems.forEach((item, index) => {
        if (item.trackStock) {
          const productRef = productRefs[index];
          const currentStock = Number(currentProducts[index].data().stock);
          transaction.update(productRef, { stock: currentStock - item.quantity, updatedAt: new Date() });
        }
      });

      return { idempotent: false, sale: safeSale };
    });

    return res.status(200).json({ confirmed: true, ...result });
  } catch (error) {
    console.error('confirm-qr-sale handler error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: status === 500 ? 'Error interno del servidor' : error.message
    });
  }
}
