import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

function validateBarcode(value) {
  const barcode = String(value || '').trim();
  if (!/^\d{7,}$/.test(barcode)) throw new Error('Código de barras inválido');
  return barcode;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await verifyFirebaseRequest(req);
    const barcode = validateBarcode(req.method === 'GET' ? req.query?.barcode : req.body?.barcode);
    const ref = getAdminDb().collection('global_products').doc(barcode);

    if (req.method === 'GET') {
      const snapshot = await ref.get();
      return res.status(200).json(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null);
    }

    const product = req.body || {};
    const snapshot = await ref.get();
    const current = snapshot.exists ? snapshot.data() : {};

    // Validaciones específicas solicitadas
    const name = String(product.name || '').trim().substring(0, 120);
    const imageUrl = String(product.imageUrl || '').trim();
    const isHttpsUrl = imageUrl.startsWith('https://');
    const isValidImage = isHttpsUrl && imageUrl.length < 500;

    const update = {
      barcode,
      ...(current.name ? {} : { name }),
      ...(current.imageUrl || !isValidImage ? {} : { imageUrl }),
      updatedAt: new Date(),
    };

    await ref.set(update, { merge: true });
    return res.status(200).json({ id: barcode, ...current, ...update });
  } catch (error) {
    console.error('Error en global-product:', error);
    const status = error.statusCode || (error.message === 'Código de barras inválido' ? 400 : 500);
    return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
}
