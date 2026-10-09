import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

const PRICES = {
  promo: { kiosco: 25000, mercado: 42500 },
  regular: { kiosco: 50000, mercado: 85000 },
};

const ALLOWED_OPERATIONS = ['cancel', 'change-plan', 'finalize-promotion'];
const ALLOWED_PLANS = ['kiosco', 'mercado'];

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const decodedToken = await verifyFirebaseRequest(req);
    const { subscriptionId, operation, targetPlan } = req.body || {};

    if (!subscriptionId || !operation) {
      return res.status(400).json({ error: 'subscriptionId y operation son requeridos' });
    }

    if (!ALLOWED_OPERATIONS.includes(operation)) {
      return res.status(400).json({ error: 'Operación no permitida' });
    }

    if (targetPlan && !ALLOWED_PLANS.includes(targetPlan)) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const db = getAdminDb();
    const tenantRef = db.collection('tenants').doc(decodedToken.uid);
    const tenantSnapshot = await tenantRef.get();

    if (!tenantSnapshot.exists || tenantSnapshot.data()?.subscriptionId !== subscriptionId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const tenantData = tenantSnapshot.data();
    const isPromoActive = tenantData?.promoActive === true;

    let updateData;
    if (operation === 'cancel') {
      updateData = { status: 'cancelled' };
    } else if (operation === 'change-plan') {
      const price = PRICES[isPromoActive ? 'promo' : 'regular'][targetPlan];
      if (!price) return res.status(400).json({ error: 'Precio no definido' });
      updateData = { auto_recurring: { transaction_amount: price } };
    } else if (operation === 'finalize-promotion') {
      const price = PRICES.regular[targetPlan || tenantData?.plan];
      if (!price) return res.status(400).json({ error: 'Precio regular no definido' });
      updateData = { auto_recurring: { transaction_amount: price } };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Error de configuración en el servidor' });

    const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error MP Update:', data);
      return res.status(mpResponse.status).json({ error: 'Error al actualizar suscripción' });
    }

    const now = new Date();
    let firestoreUpdate = { updatedAt: now };
    let isUpgrade = false;
    let downgradeDate = null;

    if (operation === 'cancel') {
      firestoreUpdate = {
        ...firestoreUpdate,
        isActive: false,
        status: 'inactive',
        subscriptionStatus: 'cancelled',
      };
    } else if (operation === 'change-plan') {
      isUpgrade = targetPlan === 'mercado';
      if (isUpgrade) {
        firestoreUpdate = {
          ...firestoreUpdate,
          plan: 'mercado',
          scheduledDowngrade: null,
          downgradeDate: null,
        };
      } else {
        const nextBillingDate = new Date();
        nextBillingDate.setDate(nextBillingDate.getDate() + 30);
        downgradeDate = nextBillingDate.toISOString();
        firestoreUpdate = {
          ...firestoreUpdate,
          scheduledDowngrade: 'kiosco',
          downgradeDate,
        };
      }
    } else if (operation === 'finalize-promotion') {
      firestoreUpdate = { ...firestoreUpdate, promoActive: false };
    }

    await Promise.all([
      db.collection('tenants').doc(decodedToken.uid).set(firestoreUpdate, { merge: true }),
      db.collection('users').doc(decodedToken.uid).set(firestoreUpdate, { merge: true }),
    ]);

    return res.status(200).json({ ...data, isUpgrade, downgradeDate });
  } catch (error) {
    console.error('update-subscription handler error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
}
