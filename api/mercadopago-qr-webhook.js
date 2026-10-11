import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';
import { mpFetch } from './_lib/mp-token.js';
import { checkAndMarkProcessing, markAsCompleted, markAsFailed, releaseProcessing } from './_lib/idempotency.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

function parseSignature(value) {
  return Object.fromEntries(String(value || '').split(',').map((part) => part.trim().split('=')));
}

function hasValidSignature(req, resourceId) {
  const secret = process.env.MP_WEBHOOK_SECRET_QR;
  if (!secret) return false;

  const header = parseSignature(req.headers['x-signature']);
  const requestId = req.headers['x-request-id'];
  if (!header.ts || !header.v1 || !requestId || !resourceId) return false;

  const manifest = `id:${resourceId};request-id:${requestId};ts:${header.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    const received = Buffer.from(header.v1, 'hex');
    const calculated = Buffer.from(expected, 'hex');
    return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resourceId = req.body?.data?.id || req.query?.id || req.body?.id;
  if (!resourceId) return res.status(200).send('OK (No ID)');

  if (!process.env.MP_WEBHOOK_SECRET_QR) {
    console.error('CRITICAL: MP_WEBHOOK_SECRET_QR not configured.');
    return res.status(401).json({ error: 'Configuración inválida' });
  }

  if (!hasValidSignature(req, resourceId)) {
    console.error(`Invalid signature for resource ${resourceId}`);
    return res.status(401).json({ error: 'Firma inválida' });
  }

  try {
    const db = getAdminDb();

    // Resolver tenantId para la idempotencia
    const orderId = req.query.orderId || resourceId;
    const indexSnap = await db.collection('qr_order_index').doc(String(orderId)).get();

    let tenantId = req.query.tenantId;
    if (indexSnap.exists) {
      tenantId = indexSnap.data().tenantId;
    }

    if (!tenantId) {
      console.warn(`No tenant mapping found for order ${orderId}`);
      return res.status(200).send('Tenant not found');
    }

    // --- INICIO IDEMPOTENCIA ---
    // Usamos el resourceId (ID de Merchant Order o Payment) como clave única de esta notificación
    const { shouldProcess, status, saleId } = await checkAndMarkProcessing(String(resourceId), tenantId, 'webhook');

    if (!shouldProcess) {
      console.log(`[Webhook] Notificación ya procesada o en curso: ${resourceId} (Estado: ${status}, Sale: ${saleId || 'N/A'})`);
      return res.status(200).send('Already processed');
    }

    try {
      const topic = req.body?.topic || req.query?.topic || 'merchant_order';
      const url = topic === 'payment'
        ? `https://api.mercadopago.com/v1/payments/${resourceId}`
        : `https://api.mercadopago.com/merchant_orders/${resourceId}`;

      const mpRes = await mpFetch(db, tenantId, url, { method: 'GET' });
      if (!mpRes.ok) throw new Error(`MP Fetch error: ${mpRes.status}`);

      const data = await mpRes.json();
      let order = data;

      if (topic === 'payment') {
        if (data.order?.id) {
          const orderRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/merchant_orders/${data.order.id}`, { method: 'GET' });
          if (orderRes.ok) order = await orderRes.json();
        } else {
          order = {
            id: data.order?.id || resourceId,
            external_reference: data.external_reference,
            status: data.status === 'approved' ? 'closed' : 'opened',
            total_amount: data.transaction_amount,
            payments: [data]
          };
        }
      }

      const externalReference = order.external_reference;
      if (!externalReference) throw new Error('No external reference');

      const approvedPayment = (order.payments || []).find(p => p.status === 'approved');

      // Actualizar estado del QR
      await db.collection('tenants').doc(tenantId).collection('qr_orders').doc(externalReference).set({
        externalReference,
        merchantOrderId: String(order.id),
        status: order.status,
        amount: order.total_amount,
        paymentId: approvedPayment ? String(approvedPayment.id) : null,
        updatedAt: new Date()
      }, { merge: true });

      if (order.id && !indexSnap.exists) {
        await db.collection('qr_order_index').doc(String(order.id)).set({
          tenantId,
          externalReference,
          updatedAt: new Date()
        }, { merge: true });
      }

      // --- AUTO-CONFIRMACIÓN DE VENTA ---
      let saleIdCreated = null;
      if (approvedPayment && externalReference) {
        // Intentar recuperar los datos de la "Venta Pendiente" guardada al crear el QR
        const pendingOrderSnap = await db.collection('qr_order_index').doc(externalReference).get();

        if (pendingOrderSnap.exists) {
          const pendingData = pendingOrderSnap.data();
          const saleId = getSaleId(tenantId, externalReference);

          const saleData = {
            id: saleId,
            shiftId: pendingData.shiftId,
            cashier: pendingData.cashier,
            total: pendingData.total,
            paymentMethod: 'qr_mp',
            items: pendingData.items,
            externalReference,
            merchantOrderId: String(order.id),
            createdAt: pendingData.createdAt || new Date().toISOString(),
          };

          const result = await finalizeSale(tenantId, saleData, String(approvedPayment.id));
          saleIdCreated = result.sale.id;

          // Limpiar el índice si la venta fue exitosa
          await db.collection('qr_order_index').doc(externalReference).delete().catch(() => {});
        }
      }

      // --- FIN EXITOSO ---
      if (saleIdCreated) {
        await markAsCompleted(String(resourceId), saleIdCreated);
      } else {
        // Si no se creó una venta (ej: pago aún no aprobado), liberamos el ID
        // para que la siguiente notificación de MP pueda ser procesada.
        await releaseProcessing(String(resourceId));
      }
      return res.status(200).send('OK');

    } catch (innerError) {
      await markAsFailed(String(resourceId), innerError.message);
      throw innerError;
    }

  } catch (error) {
    console.error('QR Webhook error:', error);
    return res.status(500).send('Internal Error');
  }
}
