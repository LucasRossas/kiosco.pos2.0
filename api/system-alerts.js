import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await verifyFirebaseRequest(req);
    const snapshot = await getAdminDb().collection('config').doc('system_alerts').get();
    return res.status(200).json(snapshot.exists ? snapshot.data() : { active: false });
  } catch (error) {
    console.error('Error leyendo alertas del sistema:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
}
