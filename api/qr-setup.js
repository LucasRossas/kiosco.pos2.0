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
    const db = getAdminDb();

    // 1. Verificar vinculación de Mercado Pago
    const privateRef = db.collection('private_integrations').doc(tenantId);
    const privateSnap = await privateRef.get();
    const mpData = privateSnap.data()?.mercadoPago;

    if (!mpData?.accessToken || !mpData?.userId) {
      return res.status(400).json({ error: 'Mercado Pago no está vinculado' });
    }

    // Idempotencia: si ya tiene qrConfig completo, devolverlo
    if (mpData.qrConfig?.qrImage) {
      return res.status(200).json(mpData.qrConfig);
    }

    const { address, city, state, latitude, longitude } = req.body || {};
    if (!address || !city || !state) {
      return res.status(400).json({ error: 'La dirección, ciudad y provincia son obligatorias' });
    }

    const mpUserId = mpData.userId;
    const externalStoreId = `store${tenantId}`;
    const externalPosId = `pos${tenantId}1`;

    // 2. Crear o Buscar Sucursal
    let mpStoreId;
    const storePayload = {
      name: "Local Principal",
      external_id: externalStoreId,
      location: {
        street_number: "S/N",
        street_name: address,
        city_name: city,
        state_name: state,
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined
      }
    };

    const storeCreateRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storePayload)
    });

    const storeCreateData = await storeCreateRes.json();

    if (storeCreateRes.ok) {
      mpStoreId = storeCreateData.id;
    } else if (storeCreateData.code === 'store_external_id_already_exists') {
      const searchRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores/search?external_id=${externalStoreId}`);
      const searchData = await searchRes.json();
      mpStoreId = searchData.results?.[0]?.id;
    }

    if (!mpStoreId) {
      console.error('Store Creation Failed:', storeCreateData);
      throw new Error(storeCreateData.message || 'Error al crear la sucursal en Mercado Pago');
    }

    // 3. Crear o Buscar Caja (POS)
    let finalPos;
    const posPayload = {
      name: "Caja Principal",
      fixed_amount: true,
      external_id: externalPosId,
      store_id: mpStoreId
    };

    const posCreateRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posPayload)
    });

    const posCreateData = await posCreateRes.json();

    if (posCreateRes.ok) {
      finalPos = posCreateData;
    } else if (posCreateData.code === 'pos_external_id_already_exists') {
      const getPosRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos?external_id=${externalPosId}`);
      const getPosData = await getPosRes.json();
      finalPos = getPosData.results?.[0];
    }

    if (!finalPos || !finalPos.qr) {
      console.error('POS Creation Failed:', posCreateData);
      throw new Error(posCreateData.message || 'Error al crear la caja en Mercado Pago');
    }

    const qrConfig = {
      posId: finalPos.id,
      externalPosId: finalPos.external_id,
      storeId: mpStoreId,
      qrImage: finalPos.qr.image,
      qrTemplate: finalPos.qr.template,
      updatedAt: new Date().toISOString()
    };

    // 4. Guardar datos en Firestore
    await db.runTransaction(async (transaction) => {
      transaction.update(privateRef, {
        'mercadoPago.qrConfig': qrConfig
      });

      const publicRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');
      transaction.set(publicRef, {
        mercadoPagoConfig: {
          qrImageUrl: qrConfig.qrImage,
          posName: finalPos.name,
          posExternalId: finalPos.external_id
        }
      }, { merge: true });
    });

    return res.status(200).json(qrConfig);

  } catch (error) {
    console.error('QR Setup Error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message || 'Error interno del servidor' });
  }
}
