import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';
import { mpFetch } from './_lib/mp-token.js';
import { checkAndMarkProcessing, markAsCompleted, markAsFailed, releaseProcessing } from './_lib/idempotency.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

/**
 * Valida la firma X-Signature de Mercado Pago (V2)
 */
function verifySignatureQR(req, resourceId) {
  const secret = process.env.MP_WEBHOOK_SECRET_QR;
  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!secret || !signatureHeader || !requestId || !resourceId) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => p.trim().split('='))
  );

  const timestamp = Number(parts.ts);
  if (!parts.v1 || isNaN(timestamp)) return false;
  // Margen de 5 minutos para evitar ataques de replay
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const manifest = `id:${resourceId};request-id:${requestId};ts:${parts.ts};`;
  const calculated = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(parts.v1, 'hex'), Buffer.from(calculated, 'hex'));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Identificar el recurso sin confiar en el cuerpo para el ruteo
  const resourceId = req.body?.data?.id || req.query?.id || req.body?.id;
  const topic = req.body?.type || req.body?.topic || req.query?.topic || 'merchant_order';

  if (!resourceId) return res.status(200).send('OK (No ID)');

  const hasSignature = !!req.headers['x-signature'];

  // Validar firma si está presente (Seguridad punto 2)
  if (hasSignature && !verifySignatureQR(req, resourceId)) {
    console.error(`[Webhook QR] Firma inválida para recurso ${resourceId}`);
    return res.status(200).send('Invalid signature');
  }

  try {
    const db = getAdminDb();

    // 2. Determinar tenantId (Contexto) - Punto 2
    let tenantId = req.query.tenantId;

    // Si no hay firma, la regla exige tenantId en la URL
    if (!hasSignature && !tenantId) {
      console.warn(`[Webhook QR] Petición sin firma y sin tenantId en URL: ${resourceId}`);
      return res.status(200).send('Untrusted request (Missing tenantId)');
    }

    // Si hay firma pero no tenantId, intentamos recuperarlo del índice interno (lookup inicial)
    if (!tenantId && hasSignature) {
      const indexSnap = await db.collection('qr_order_index').doc(String(resourceId)).get();
      if (indexSnap.exists) {
        tenantId = indexSnap.data().tenantId;
      }
    }

    if (!tenantId) {
      return res.status(200).send('Tenant context not found');
    }

    // 3. Idempotencia: Bloqueo de procesamiento - Punto 1
    const idempotencyKey = `mp-qr-webhook-${resourceId}`;
    const { shouldProcess, status: currentStatus } = await checkAndMarkProcessing(idempotencyKey, tenantId, 'mp-qr-webhook');

    if (!shouldProcess) {
      return res.status(200).send(`Already processing (${currentStatus})`);
    }

    try {
      // 4. Consultar API de Mercado Pago (Seguridad Real: usamos el token del comercio) - Punto 2
      const url = topic === 'payment'
        ? `https://api.mercadopago.com/v1/payments/${resourceId}`
        : `https://api.mercadopago.com/merchant_orders/${resourceId}`;

      const mpRes = await mpFetch(db, tenantId, url);
      if (!mpRes.ok) {
        await releaseProcessing(idempotencyKey);
        // Respondemos 500 en errores de MP para reintento, 200 si no existe
        return res.status(mpRes.status === 404 ? 200 : 500).send('Error fetching from MP');
      }

      const mpData = await mpRes.json();
      let merchantOrder = mpData;
      let payment = null;

      if (topic === 'payment') {
        if (mpData.order?.id) {
          const moRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/merchant_orders/${mpData.order.id}`);
          if (moRes.ok) merchantOrder = await moRes.json();
        }
        payment = mpData;
      } else {
        payment = (mpData.payments || []).find(p => p.status === 'approved');
      }

      const extRef = merchantOrder.external_reference;

      // REGLA: Si no hay firma, validar que el external_reference empiece con pos-{tenantId}-
      if (!hasSignature) {
        if (!extRef || !extRef.startsWith(`pos-${tenantId}-`)) {
          console.warn(`[Webhook QR] Referencia externa no válida para tenant ${tenantId}: ${extRef}`);
          await releaseProcessing(idempotencyKey);
          return res.status(200).send('Untrusted external reference');
        }
      }

      if (!extRef) {
        console.warn(`[Webhook QR] Orden ${resourceId} sin external_reference`);
        await releaseProcessing(idempotencyKey);
        return res.status(200).send('Missing reference');
      }

      // 5. Verificar estado de pago - Punto 1
      const isPaid = (merchantOrder.status === 'closed' || merchantOrder.order_status === 'paid') && payment;

      if (isPaid) {
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
              paymentMethod: 'qr_mp',
              paymentId: String(payment.id),
              externalReference: extRef,
              merchantOrderId: String(merchantOrder.id),
              createdAt: qrOrderData.createdAt || new Date().toISOString(),
            };

            // Finalizar la venta (Stock, Registro, etc.)
            const result = await finalizeSale(tenantId, saleData, String(payment.id));

            await qrOrderRef.update({
              status: 'paid',
              paymentId: String(payment.id),
              merchantOrderId: String(merchantOrder.id),
              saleId: result.sale.id,
              updatedAt: new Date().toISOString()
            });

            // Regla: Marcar como completado SOLO después de crear la venta (Punto 1)
            await markAsCompleted(idempotencyKey, result.sale.id);

            // Limpiar índice global
            await db.collection('qr_order_index').doc(extRef).delete().catch(() => {});

            console.log(`[Webhook QR] Venta finalizada: ${result.sale.id}`);
          } else {
            // Ya estaba pagado
            await markAsCompleted(idempotencyKey, qrOrderData.saleId || 'already-paid');
            await db.collection('qr_order_index').doc(extRef).delete().catch(() => {});
          }
        } else {
          console.warn(`[Webhook QR] No existe qr_order para ${extRef}`);
          await releaseProcessing(idempotencyKey);
        }
      } else {
        // Regla: Si no está aprobado, liberar bloqueo y responder 200 (Punto 1)
        console.log(`[Webhook QR] Orden ${extRef} aún pendiente (${merchantOrder.status})`);
        await releaseProcessing(idempotencyKey);
      }

      return res.status(200).send('OK');

    } catch (innerError) {
      await markAsFailed(idempotencyKey, innerError.message);
      throw innerError;
    }

  } catch (error) {
    console.error('[Webhook QR] Error Crítico:', error);
    // Regla: Ante error inesperado respondé 500 para reintento (Punto 3)
    return res.status(500).send('Internal Server Error');
  }
}
