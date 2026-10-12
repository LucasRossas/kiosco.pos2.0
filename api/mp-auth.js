import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { createOAuthState, verifyOAuthState } from './_lib/oauth-state.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import admin from 'firebase-admin';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  const { method } = req;
  const { action } = req.query;
  const appOrigin = (process.env.APP_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');

  try {
    // 1. INICIAR OAUTH (GET o POST /api/mp/oauth/start)
    if (action === 'start') {
      const decodedToken = await verifyFirebaseRequest(req);
      const state = createOAuthState(decodedToken.uid);
      const { MP_CLIENT_ID, MP_REDIRECT_URI } = process.env;

      // Devolvemos los datos para que el frontend construya la URL o el frontend puede redirigir
      return res.status(200).json({
        url: `https://auth.mercadopago.com.ar/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${MP_REDIRECT_URI}`,
        state,
        clientId: MP_CLIENT_ID,
        redirectUri: MP_REDIRECT_URI
      });
    }

    // 2. CALLBACK (GET /api/mp/oauth/callback)
    if (action === 'callback') {
      const { code, state } = req.query;
      if (!code || !state) return res.redirect(`${appOrigin}/settings?mp=error&msg=missing_params`);

      const verified = verifyOAuthState(state);
      if (!verified) return res.redirect(`${appOrigin}/settings?mp=error&msg=invalid_state`);

      const tenantId = verified.uid;
      const { MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI } = process.env;

      const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: MP_CLIENT_ID,
          client_secret: MP_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: MP_REDIRECT_URI,
        }),
      });

      const data = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(data.message || 'Error al obtener tokens de MP');

      const db = getAdminDb();
      const expiresAt = Date.now() + (data.expires_in * 1000);

      await db.runTransaction(async (t) => {
        const privRef = db.collection('private_integrations').doc(tenantId);
        t.set(privRef, {
          mercadoPago: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            publicKey: data.public_key,
            userId: data.user_id,
            expiresAt: expiresAt,
            connectedAt: new Date().toISOString(),
            status: 'connected'
          }
        }, { merge: true });

        const pubRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');
        t.set(pubRef, {
          mercadoPagoConfig: {
            habilitado: true,
            connected: true,
            userId: data.user_id,
            vinculadoAt: new Date().toISOString(),
            publicKey: data.public_key
          }
        }, { merge: true });
      });

      return res.redirect(`${appOrigin}/settings?mp=connected`);
    }

    // 3. STATUS (GET /api/mp/status)
    if (action === 'status') {
      const decodedToken = await verifyFirebaseRequest(req);
      const db = getAdminDb();
      const privDoc = await db.collection('private_integrations').doc(decodedToken.uid).get();

      const mpData = privDoc.data()?.mercadoPago;
      return res.status(200).json({
        connected: !!mpData,
        userId: mpData?.userId || null,
        connectedAt: mpData?.connectedAt || null
      });
    }

    // 4. DISCONNECT (POST /api/mp/oauth/disconnect)
    if (action === 'disconnect') {
      const decodedToken = await verifyFirebaseRequest(req);
      const db = getAdminDb();

      await db.runTransaction(async (t) => {
        const privRef = db.collection('private_integrations').doc(decodedToken.uid);
        t.set(privRef, {
          mercadoPago: admin.firestore.FieldValue.delete()
        }, { merge: true });

        const pubRef = db.collection('tenants').doc(decodedToken.uid).collection('config').doc('settings');
        t.set(pubRef, {
          mercadoPagoConfig: {
            habilitado: false,
            connected: false,
            userId: null,
            vinculadoAt: null,
            qrImageUrl: null
          }
        }, { merge: true });
      });

      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error en mp-auth:', error);
    if (action === 'callback') return res.redirect(`${appOrigin}/settings?mp=error`);
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
