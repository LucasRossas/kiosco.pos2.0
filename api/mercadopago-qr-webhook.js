import { getAdminDb } from './_lib/firebase-admin.js';
import { mpFetch } from './_lib/mp-token.js';
import { checkAndMarkProcessing, markAsCompleted, markAsFailed, releaseProcessing } from './_lib/idempotency.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resourceId = req.body?.data?.id || req.query?.id || req.body?.id;
  const topic = req.body?.type || req.body?.topic || req.query?.topic || 'merchant_order';

  if (!resourceId) {
    return res.status(200).send('OK (No ID)');
  }

  try {
    const db = getAdminDb();

    // 2. Resolver tenantId
    let indexSnap = await db.collection('qr_order_index').doc(String(resourceId)).get();

    const externalReference = req.body?.external_reference || req.query?.external_reference;
    if (!indexSnap.exists && externalReference) {
      indexSnap = await db.collection('qr_order_index').doc(String(externalReference)).get();
    }

    let tenantId = req.query.tenantId || (indexSnap.exists ? indexSnap.data().tenantId : null);

    if (!tenantId) {
      console.warn(`[Webhook] No se pudo determinar tenantId para recurso ${resourceId}.`);
      return res.status(200).send('Tenant context missing');
    }

    // 4. IDEMPOTENCIA
    const idempotencyKey = `mp-webhook-${resourceId}`;
    const { shouldProcess, status: currentStatus } = await checkAndMarkProcessing(idempotencyKey, tenantId, 'mp-webhook');

    if (!shouldProcess) {
      console.log(`[Webhook] Ya procesado o en curso: ${idempotencyKey} (Estado: ${currentStatus})`);
      return res.status(200).send('Already processed');
    }

    try {
      // 5. Consultar API de Mercado Pago
      const url = topic === 'payment'
        ? `https://api.mercadopago.com/v1/payments/${resourceId}`
        : `https://api.mercadopago.com/merchant_orders/${resourceId}`;

      const mpRes = await mpFetch(db, tenantId, url);
      if (!mpRes.ok) throw new Error(`Error MP API: ${mpRes.status}`);
      const data = await mpRes.json();

      let merchantOrder = data;
      let payment = null;

      if (topic === 'payment') {
        if (data.order?.id) {
          const moRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/merchant_orders/${data.order.id}`);
          if (moRes.ok) merchantOrder = await moRes.json();
        }
        payment = data;
      } else {
        payment = (data.payments || []).find(p => p.status === 'approved');
      }

      const extRef = merchantOrder.external_reference;
      if (!extRef) {
        console.warn(`[Webhook] Orden ${resourceId} no tiene external_reference`);
        await releaseProcessing(idempotencyKey);
        return res.status(200).send('No external reference');
      }

      const isPaid = merchantOrder.status === 'closed' || merchantOrder.order_status === 'paid';

      if (isPaid && payment) {
        const qrOrderRef = db.collection('tenants').doc(tenantId).collection('qr_orders').doc(extRef);
        const qrOrderSnap = await qrOrderRef.get();

        if (qrOrderSnap.exists) {
          const qrOrderData = qrOrderSnap.data();

          if (qrOrderData.status !== 'paid') {
            const saleId = getSaleId(tenantId, extRef);
            const saleData = {
              id: saleId,
              ...qrOrderData.saleMetadata,
              total: qrOrderData.amount,
              paymentMethod: 'qr_mercado_pago',
              paymentId: String(payment.id),
              externalReference: extRef,
              merchantOrderId: String(merchantOrder.id),
              createdAt: qrOrderData.createdAt || new Date().toISOString(),
            };

            const result = await finalizeSale(tenantId, saleData, String(payment.id));

            await qrOrderRef.update({
              status: 'paid',
              paymentId: String(payment.id),
              merchantOrderId: String(merchantOrder.id),
              updatedAt: new Date().toISOString()
            });

            await markAsCompleted(idempotencyKey, result.sale.id);
            console.log(`[Webhook] Venta finalizada exitosamente: ${result.sale.id}`);
          } else {
            await markAsCompleted(idempotencyKey, qrOrderData.saleId || 'already-paid');
          }
        } else {
          console.warn(`[Webhook] No se encontró qr_order para ${extRef}`);
          await releaseProcessing(idempotencyKey);
        }
      } else {
        console.log(`[Webhook] Orden ${extRef} aún no pagada (${merchantOrder.status})`);
        await releaseProcessing(idempotencyKey);
      }

      return res.status(200).send('OK');

    } catch (innerError) {
      await markAsFailed(idempotencyKey, innerError.message);
      throw innerError;
    }

  } catch (error) {
    console.error('QR Webhook Error:', error);
    return res.status(500).send('Internal Error');
  }
}
