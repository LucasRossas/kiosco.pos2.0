import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';

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
  // No CORS para webhooks (MP llama directamente)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const queryResourceId = req.query?.['data.id'];
  const bodyResourceId = req.body?.data?.id;

  if (String(queryResourceId || bodyResourceId) === '123456') {
    return res.status(200).send('OK');
  }

  const resourceId = bodyResourceId || req.query?.id || queryResourceId;
  if (!verifySignature(req, resourceId)) {
    console.error('Webhook signature verification failed');
    return res.status(401).json({ error: 'Firma inválida' });
  }

  try {
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('Config missing');

    const type = req.body?.type;
    if (type !== 'subscription_preapproval' && type !== 'subscription_preapproval_plan') {
      return res.status(200).json({ ignored: true });
    }

    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    if (!response.ok) throw new Error('Verificación fallida');

    const subscription = await response.json();
    const tenantId = subscription.external_reference;
    if (!tenantId) throw new Error('External reference missing');

    const db = getAdminDb();
    const tenantRef = db.collection('tenants').doc(tenantId);
    const tenantSnapshot = await tenantRef.get();

    if (!tenantSnapshot.exists || tenantSnapshot.data()?.subscriptionId !== resourceId) {
       if (tenantSnapshot.data()?.subscriptionId) {
         return res.status(200).send('Mismatch');
       }
    }

    const status = subscription.status;
    let update = {
      subscriptionStatus: status,
      lastStatusUpdate: new Date(),
    };

    if (status === 'authorized') {
      update.isActive = true;
      update.status = 'active';
      update.activatedAt = new Date();
    } else if (status === 'cancelled' || status === 'paused') {
      update.isActive = false;
      update.status = 'inactive';
    }

    await Promise.all([
      tenantRef.set(update, { merge: true }),
      db.collection('users').doc(tenantId).set(update, { merge: true }),
    ]);

    return res.status(200).json({ status });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).send('Handled');
  }
}
