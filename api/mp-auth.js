import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { createOAuthState, verifyOAuthState } from './_lib/oauth-state.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import admin from 'firebase-admin';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  const { method } = req;
  const { action } = req.query;
  const baseUrl = (process.env.APP_ORIGIN || 'https://puntogestionpos.com.ar').split(',')[0].trim().replace(/\/$/, '');

  if (method === 'GET') {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Faltan parámetros: code o state');

    try {
      const verified = verifyOAuthState(state);
      const tenantId = verified.uid;
      const { MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI } = process.env;

      const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: MP_CLIENT_ID,
          client_secret: MP_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: MP_REDIRECT_URI,
        }),
      });

      const data = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(data.message || 'Error al obtener tokens de Mercado Pago');

      const expiresAt = Date.now() + (data.expires_in * 1000);

      const db = getAdminDb();
      await db.runTransaction(async (transaction) => {
        const privateRef = db.collection('private_integrations').doc(tenantId);
        const publicRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');
        transaction.set(privateRef, {
          mercadoPago: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            userId: data.user_id,
            expiresAt,
            updatedAt: new Date().toISOString()
          }
        }, { merge: true });
        transaction.set(publicRef, {
          mercadoPagoConfig: {
            userId: data.user_id,
            habilitado: true,
            vinculadoAt: new Date().toISOString()
          }
        }, { merge: true });
      });

      return res.redirect(`${baseUrl}/settings?mp_status=success`);
    } catch (error) {
      console.error('Error OAuth MP:', error);
      // No devolver error.message en el HTML, redirigir con estado de error
      return res.redirect(`${baseUrl}/settings?mp_status=error`);
    }
  }

  if (method === 'POST') {
    try {
      const token = await verifyFirebaseRequest(req);
      const db = getAdminDb();

      if (action === 'disconnect') {
        // Usar set con merge: true en lugar de update para evitar fallos si el documento no existe
        await db.collection('private_integrations').doc(token.uid).set({
          mercadoPago: admin.firestore.FieldValue.delete()
        }, { merge: true });

        await db.collection('tenants').doc(token.uid).collection('config').doc('settings').set({
          mercadoPagoConfig: { habilitado: false, userId: null, vinculadoAt: null }
        }, { merge: true });

        return res.status(200).json({ success: true });
      }

      return res.status(200).json({
        state: createOAuthState(token.uid),
        clientId: process.env.MP_CLIENT_ID,
        redirectUri: process.env.MP_REDIRECT_URI
      });
    } catch (error) {
      console.error('Error en mp-auth POST:', error);
      const status = error.statusCode || 500;
      return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
