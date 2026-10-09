import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const { externalReference } = req.body || {};

    if (!externalReference) {
      return res.status(400).json({ error: 'Parámetros faltantes' });
    }

    const db = getAdminDb();
    const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}`;

    const response = await mpFetch(db, tenantId, url, {
      method: 'GET'
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('MP Search Error:', data);
      return res.status(response.status).json({
        error: 'Error al consultar estado en el procesador de pagos'
      });
    }

    const isApproved = data.results && data.results.some(payment => payment.status === 'approved');

    return res.status(200).json({ status: isApproved ? 'approved' : 'pending' });
  } catch (error) {
    console.error('check-status error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: status === 500 ? 'Error interno del servidor' : error.message
    });
  }
}
