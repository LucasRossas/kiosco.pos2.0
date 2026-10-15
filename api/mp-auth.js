import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { createOAuthState, verifyOAuthState } from './_lib/oauth-state.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  const { action } = req.query;
  const appOrigin = (process.env.APP_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');

  try {
    // 1. INICIAR OAUTH (Construcción limpia con URLSearchParams)
    if (action === 'start') {
      const decodedToken = await verifyFirebaseRequest(req);
      const state = createOAuthState(decodedToken.uid);
      const { MP_CLIENT_ID, MP_REDIRECT_URI } = process.env;

      if (!MP_CLIENT_ID || !MP_REDIRECT_URI) {
        throw new Error('Configuración de Mercado Pago incompleta (MP_CLIENT_ID o MP_REDIRECT_URI)');
      }

      // Usamos URLSearchParams para asegurar que la redirect_uri y el state se codifiquen correctamente
      const params = new URLSearchParams({
        client_id: MP_CLIENT_ID,
        response_type: 'code',
        platform_id: 'mp',
        state: state,
        redirect_uri: MP_REDIRECT_URI
      });

      const authUrl = `https://auth.mercadopago.com.ar/authorization?${params.toString()}`;

      return res.status(200).json({
        url: authUrl,
        state,
        clientId: MP_CLIENT_ID,
        redirectUri: MP_REDIRECT_URI
      });
    }

    // 2. CALLBACK (Intercambio de código por token)
    if (action === 'callback') {
      const { code, state } = req.query;

      if (!code || !state) {
        console.error('[MP OAuth] Callback fallido: faltan parámetros', { code: !!code, state: !!state });
        return res.redirect(`${appOrigin}/settings?mp=error&msg=missing_params`);
      }

      const verified = verifyOAuthState(state);
      if (!verified) {
        console.error('[MP OAuth] State inválido o expirado');
        return res.redirect(`${appOrigin}/settings?mp=error&msg=invalid_state`);
      }

      const tenantId = verified.uid;
      const { MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI } = process.env;

      // El redirect_uri aquí debe ser IDÉNTICO al enviado en el paso 'start'
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
      if (!tokenResponse.ok) {
        console.error('[MP OAuth] Error al canjear token:', data);
        throw new Error(data.message || 'Error en el intercambio de tokens');
      }

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
            publicKey: data.public_key,
            qrConfigs: {}
          }
        }, { merge: true });
      });

      console.log(`[MP OAuth] Conexión exitosa para tenant: ${tenantId}`);
      return res.redirect(`${appOrigin}/settings?mp=connected`);
    }

    // 3. STATUS
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

    // 4. DISCONNECT
    if (action === 'disconnect') {
      const decodedToken = await verifyFirebaseRequest(req);
      const db = getAdminDb();
      const tenantId = decodedToken.uid;

      await db.runTransaction(async (t) => {
        const privRef = db.collection('private_integrations').doc(tenantId);
        const pubRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');

        t.update(privRef, {
          mercadoPago: FieldValue.delete()
        });

        t.update(pubRef, {
          'mercadoPagoConfig.habilitado': false,
          'mercadoPagoConfig.connected': false,
          'mercadoPagoConfig.userId': null,
          'mercadoPagoConfig.vinculadoAt': null,
          'mercadoPagoConfig.publicKey': null,
          'mercadoPagoConfig.qrImageUrl': null,
          'mercadoPagoConfig.qrConfigs': {},
          'mercadoPagoConfig.posId': null,
          'mercadoPagoConfig.externalPosId': null,
          'mercadoPagoConfig.storeId': null,
          'mercadoPagoConfig.posName': null,
          'mercadoPagoConfig.lastSync': null
        });
      });

      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error en mp-auth:', error);
    if (action === 'callback') return res.redirect(`${appOrigin}/settings?mp=error`);
    return res.status(500).json({ error: error.message });
  }
}
