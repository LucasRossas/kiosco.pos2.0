import crypto from 'node:crypto';
import { getAdminDb } from './_lib/firebase-admin.js';
import { mpFetch } from './_lib/mp-token.js';

function parseSignature(value) {
  return Object.fromEntries(String(value || '').split(',').map((part) => part.trim().split('=')));
}

function hasValidSignature(req, resourceId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('CRITICAL: MP_WEBHOOK_SECRET is not configured.');
    return false;
  }
  const header = parseSignature(req.headers['x-signature']);
  const requestId = req.headers['x-request-id'];
  if (!header.ts || !header.v1 || !requestId || !resourceId) return false;
  const age = Math.abs(Date.now() / 1000 - Number(header.ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const manifest = `id:${resourceId};request-id:${requestId};ts:${header.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const received = Buffer.from(header.v1, 'hex');
  const calculated = Buffer.from(expected, 'hex');
  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantId } = req.query;
  const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

  if (!tenantId || !/^[a-zA-Z0-9]+$/.test(tenantId)) {
    return res.status(200).send('Invalid or missing tenantId');
  }

  if (!paymentId) return res.status(200).send('No data id');

  if (!process.env.MP_WEBHOOK_SECRET) {
    console.error('Webhook secret not configured');
    return res.status(500).json({ error: 'Error interno del servidor' });
  }

  if (!hasValidSignature(req, paymentId)) {
    console.error('Firma de webhook inválida para payment:', paymentId);
    return res.status(401).json({ error: 'Firma inválida' });
  }

  try {
    const db = getAdminDb();

    const response = await mpFetch(db, tenantId, `https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: 'GET'
    });

    if (!response.ok) {
      console.error(`Could not fetch payment ${paymentId} for tenant ${tenantId}`);
      return res.status(200).send('Payment fetch failed');
    }

    const paymentData = await response.json();
    const externalReference = paymentData.external_reference;

    if (!externalReference || !externalReference.startsWith(`pos-${tenantId}-`)) {
      console.warn(`Ignored payment ${paymentId}: Reference mismatch or missing.`);
      return res.status(200).send('Ignored: Reference mismatch');
    }

    await db.collection('tenants').doc(tenantId).collection('qr_payments').doc(String(paymentId)).set({
      paymentId: String(paymentId),
      externalReference,
      status: paymentData.status,
      statusDetail: paymentData.status_detail,
      amount: paymentData.transaction_amount,
      updatedAt: new Date(),
    }, { merge: true });

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).send('Error handled');
  }
}
