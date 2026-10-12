import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';
import { mpFetch } from './_lib/mp-token.js';
import { checkAndMarkProcessing, markAsCompleted, markAsFailed, releaseProcessing } from './_lib/idempotency.js';
import { getSaleId, finalizeSale } from './_lib/sales.js';

/**
 * Valida la firma X-Signature de Mercado Pago (QR V2 / Merchant Orders)
 */
function hasValidSignature(req, resourceId) {
  const secret = process.env.MP_WEBHOOK_SECRET_QR;
  if (!secret) return true; // TODO: Cambiar a false en prod estricto si se desea forzar firma

  const xSignature = req.headers['x-signature'];
  if (!xSignature) return false;

  try {
    const parts = Object.fromEntries(xSignature.split(',').map(p => p.trim().split('=')));
    const requestId = req.headers['x-request-id'];

    if (!parts.ts || !parts.v1 || !requestId) return false;

    const manifest = `id:${resourceId};request-id:${requestId};ts:${parts.ts};`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    // Usar timingSafeEqual para evitar ataques de timing
    return crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expectedSignature));
  } catch (e) {
    console.error('Error validando firma:', e);
    return false;
  }
}

export default async function handler(req, res) {
  // 1. Responder rápido a MP para evitar reintentos innecesarios (Idempotencia)
  // Pero necesitamos procesar, así que lo hacemos dentro del handler.
  // En Serverless/Cloud Functions es mejor responder al final,
  // pero en Heroku con un solo dyno, procesar síncronamente está bien.

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resourceId = req.body?.data?.id || req.query?.id || req.body?.id;
  const topic = req.body?.type || req.body?.topic || req.query?.topic || 'merchant_order';

  if (!resourceId) {
    return res.status(200).send('OK (No ID)');
  }

  try {
    const db = getAdminDb();

    // 2. Resolver tenantId
    // Buscamos en el índice global que creamos al generar el QR
    // Intentamos por resourceId (si es Merchant Order) o por external_reference si lo tenemos
    let indexSnap = await db.collection('qr_order_index').doc(String(resourceId)).get();

    // Si no está por ID, puede ser que el webhook traiga un external_reference en el query o body
    const externalReference = req.body?.external_reference || req.query?.external_reference;
    if (!indexSnap.exists && externalReference) {
      indexSnap = await db.collection('qr_order_index').doc(String(externalReference)).get();
    }

    // 3. Si aún no tenemos tenantId, no podemos procesar.
    // Pero si es un webhook de 'payment', primero consultamos a MP para obtener el merchant_order y su external_reference
    let tenantId = req.query.tenantId || (indexSnap.exists ? indexSnap.data().tenantId : null);

    if (!tenantId) {
      // Caso especial: Notificación de pago sin tenantId en URL.
      // Si no tenemos tenantId, no podemos usar mpFetch.
      // Por eso es CRÍTICO pasar ?tenantId=... en la notification_url al crear la orden.
      console.warn(`[Webhook] No se pudo determinar tenantId para recurso ${resourceId}. Asegúrate de incluirlo en la notification_url.`);
      return res.status(200).send('Tenant context missing');
    }

    // 4. IDEMPOTENCIA: Evitar doble procesamiento (notificación de pago + notificación de orden)
    // Usamos un prefijo para distinguir de otros procesos si fuera necesario
    const idempotencyKey = `mp-webhook-${resourceId}`;
    const { shouldProcess, status: currentStatus, saleId: existingSaleId } = await checkAndMarkProcessing(idempotencyKey, tenantId, 'mp-webhook');

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
        // Si recibimos un pago, buscamos su orden para tener el external_reference y estado global
        if (data.order?.id) {
          const moRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/merchant_orders/${data.order.id}`);
          if (moRes.ok) merchantOrder = await moRes.json();
        }
        payment = data;
      } else {
        // Es una merchant_order, buscamos el pago aprobado
        payment = (data.payments || []).find(p => p.status === 'approved');
      }

      const extRef = merchantOrder.external_reference;
      if (!extRef) {
        console.warn(`[Webhook] Orden ${resourceId} no tiene external_reference`);
        await releaseProcessing(idempotencyKey);
        return res.status(200).send('No external reference');
      }

      // 6. Verificar si está pagado y procesar venta
      const isPaid = merchantOrder.status === 'closed' || merchantOrder.order_status === 'paid';

      if (isPaid && payment) {
        // Recuperar la "Venta Pendiente" guardada en qr_orders
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

            // Actualizar el documento del QR para que el frontend deje de mostrar el spinner
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
        // Si aún no está pagado (ej: pago pendiente), liberamos para el próximo webhook
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
    // Respondemos 200 de todos modos para que MP no nos sature con reintentos
    // si el error es de nuestra lógica (excepto si queremos que reintente)
    return res.status(500).send('Internal Error');
  }
}

