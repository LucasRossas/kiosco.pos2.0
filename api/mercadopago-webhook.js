import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';
import { checkAndMarkProcessing, markAsCompleted, markAsFailed } from './_lib/idempotency.js';

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

function parseSignature(value) {
  return Object.fromEntries(
    String(value || '')
      .split(',')
      .map((part) => part.trim().split('='))
      .filter(([key, signature]) => key && signature)
  );
}

function verifySignature(req, resourceId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!secret || !signatureHeader || !requestId || !resourceId) return false;

  const signature = parseSignature(signatureHeader);
  const timestamp = Number(signature.ts);
  if (!signature.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > MAX_SIGNATURE_AGE_SECONDS) return false;

  const manifest = `id:${resourceId};request-id:${requestId};ts:${signature.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const received = Buffer.from(signature.v1, 'hex');
  const calculated = Buffer.from(expected, 'hex');
  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bodyResourceId = req.body?.data?.id;
  const queryResourceId = req.query?.['data.id'];
  const resourceId = bodyResourceId || req.query?.id || queryResourceId;

  // Bypass solo para testing local
  if (process.env.NODE_ENV !== 'production' && String(resourceId) === '123456') {
    return res.status(200).send('OK');
  }

  if (!verifySignature(req, resourceId)) {
    console.error('Webhook signature verification failed');
    return res.status(401).json({ error: 'Firma inválida' });
  }

  try {
    const db = getAdminDb();

    // Para suscripciones, no siempre tenemos tenantId al inicio, usamos el resourceId
    // El tenantId se extraerá de la suscripción misma luego de validarla.
    const { shouldProcess, status } = await checkAndMarkProcessing(String(resourceId), 'system_subscription', 'subscription_webhook');

    if (!shouldProcess) {
      console.log(`[Subscription Webhook] Ya procesado: ${resourceId} (${status})`);
      return res.status(200).send('OK');
    }

    try {
      if (!process.env.MP_ACCESS_TOKEN) throw new Error('Config missing');

      const type = req.body?.type;
      if (type !== 'subscription_preapproval' && type !== 'subscription_preapproval_plan') {
        await markAsCompleted(String(resourceId), 'ignored');
        return res.status(200).json({ ignored: true });
      }

      const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      });
      if (!response.ok) throw new Error('Verificación fallida en MP');

      const subscription = await response.json();
      const tenantId = subscription.external_reference;
      if (!tenantId) throw new Error('External reference missing in subscription');

      const tenantRef = db.collection('tenants').doc(tenantId);
      const mpStatus = subscription.status;
      let update = {
        subscriptionStatus: mpStatus,
        lastStatusUpdate: new Date(),
      };

      if (mpStatus === 'authorized') {
        update.isActive = true;
        update.status = 'active';
        update.activatedAt = new Date();
      } else if (mpStatus === 'cancelled' || mpStatus === 'paused') {
        update.isActive = false;
        update.status = 'inactive';
      }

      await Promise.all([
        tenantRef.set(update, { merge: true }),
        db.collection('users').doc(tenantId).set(update, { merge: true }),
      ]);

      await markAsCompleted(String(resourceId), tenantId);
      return res.status(200).json({ status: mpStatus });

    } catch (innerError) {
      await markAsFailed(String(resourceId), innerError.message);
      throw innerError;
    }
  } catch (error) {
    console.error('Webhook error:', error);
    // Devolvemos 500 para que Mercado Pago reintente en errores transitorios
    return res.status(500).json({ error: error.message });
  }
}
