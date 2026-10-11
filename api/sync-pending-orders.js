import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

/**
 * Este endpoint permite sincronizar órdenes que quedaron "pendientes" en el backend local
 * pero que podrían haber sido pagadas en Mercado Pago.
 * Útil tras reinicios de servidor o fallos de webhooks.
 */
export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();

    // 1. Buscar órdenes pendientes de los últimos 60 minutos
    const oneHourAgo = new Date(Date.now() - 60 * 60000);
    const pendingSnaps = await db.collection('qr_order_index')
      .where('tenantId', '==', tenantId)
      .where('status', '==', 'pending')
      .where('createdAt', '>=', oneHourAgo)
      .get();

    if (pendingSnaps.empty) {
      return res.status(200).json({ message: 'No hay órdenes pendientes para sincronizar', syncCount: 0 });
    }

    const results = [];

    for (const doc of pendingSnaps.docs) {
      const orderData = doc.data();
      const extRef = orderData.externalReference;

      try {
        // Consultar en MP por external_reference
        const mpSearchRes = await mpFetch(db, tenantId,
          `https://api.mercadopago.com/merchant_orders/search?external_reference=${encodeURIComponent(extRef)}`,
          { method: 'GET' }
        );

        if (!mpSearchRes.ok) continue;

        const searchData = await mpSearchRes.json();
        const mpOrder = (searchData.elements || []).find(o => o.external_reference === extRef);

        if (mpOrder && (mpOrder.status === 'closed' || mpOrder.order_status === 'paid')) {
          const approvedPayment = (mpOrder.payments || []).find(p => p.status === 'approved');

          if (approvedPayment) {
            const saleId = getSaleId(tenantId, extRef);
            const saleData = {
              id: saleId,
              shiftId: orderData.shiftId,
              cashier: orderData.cashier,
              total: orderData.total,
              paymentMethod: 'qr_mp',
              items: orderData.items,
              externalReference: extRef,
              merchantOrderId: String(mpOrder.id),
              createdAt: orderData.createdAt.toDate?.().toISOString() || new Date().toISOString(),
            };

            // La función finalizeSale ya es idempotente gracias a qr_payment_claims
            const finalizeResult = await finalizeSale(tenantId, saleData, String(approvedPayment.id));

            // Si se confirmó, borrar del índice
            await doc.ref.delete();

            results.push({ externalReference: extRef, status: 'synced', saleId: finalizeResult.sale.id });
          }
        }
      } catch (err) {
        console.error(`Error sincronizando orden ${extRef}:`, err);
      }
    }

    return res.status(200).json({
      message: 'Sincronización completada',
      syncCount: results.length,
      details: results
    });

  } catch (error) {
    console.error('Sync Error:', error);
    return res.status(500).json({ error: 'Error interno de sincronización' });
  }
}
