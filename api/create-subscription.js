import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

const OFFICIAL_PLANS = {
  kiosco: {
    name: 'Kiosco',
    price: 25000
  },
  mercado: {
    name: 'Mercado',
    price: 42500
  }
};

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const decodedToken = await verifyFirebaseRequest(req);

    if (decodedToken.email_verified !== true) {
      return res.status(403).json({ error: 'Email no verificado' });
    }

    const { planKey } = req.body || {};
    const tenantId = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase().trim();

    if (!planKey || !OFFICIAL_PLANS[planKey]) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const db = getAdminDb();
    const tenantRef = db.collection('tenants').doc(tenantId);
    const tenantSnap = await tenantRef.get();
    const tenantData = tenantSnap.data();

    const currentStatus = tenantData?.subscriptionStatus;
    if (currentStatus === 'authorized' || currentStatus === 'pending') {
      return res.status(409).json({
        error: 'Suscripción activa o pendiente',
        subscriptionId: tenantData.subscriptionId
      });
    }

    const selectedPlan = OFFICIAL_PLANS[planKey];
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.includes(email)) {
      const update = {
        plan: planKey,
        isActive: true,
        status: 'active',
        subscriptionStatus: 'admin_bypass',
        activatedAt: new Date().toISOString(),
        updatedAt: new Date(),
      };
      await Promise.all([
        db.collection('users').doc(tenantId).set(update, { merge: true }),
        tenantRef.set(update, { merge: true }),
      ]);
      return res.status(200).json({ adminBypass: true });
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const APP_ORIGIN_API = process.env.APP_ORIGIN_API;

    if (!MP_ACCESS_TOKEN || !APP_ORIGIN_API) {
      console.error('CRITICAL: MP_ACCESS_TOKEN or APP_ORIGIN_API not configured');
      return res.status(500).json({ error: 'Error interno de configuración' });
    }

    const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: `PuntoGestión POS - Plan ${selectedPlan.name}`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: selectedPlan.price,
          currency_id: 'ARS'
        },
        payer_email: email,
        back_url: `${(process.env.APP_ORIGIN || 'https://puntogestionpos.com.ar').split(',')[0]}/?payment=pending`,
        notification_url: `${APP_ORIGIN_API}/api/mercadopago-webhook`,
        external_reference: tenantId,
        status: 'pending'
      })
    });

    const data = await mpResponse.json();
    if (!mpResponse.ok) {
        console.error('MP API Error:', data);
        return res.status(mpResponse.status).json({ error: 'Error del procesador de pagos' });
    }

    await tenantRef.set({
      plan: planKey,
      subscriptionId: data.id,
      subscriptionStatus: data.status || 'pending',
      priceCurrent: selectedPlan.price,
      updatedAt: new Date(),
    }, { merge: true });

    return res.status(200).json(data);
  } catch (error) {
    console.error('create-subscription error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
}
