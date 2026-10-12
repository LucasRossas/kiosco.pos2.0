import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();

    // 1. Obtener credenciales del tenant
    const privateRef = db.collection('private_integrations').doc(tenantId);
    const privateSnap = await privateRef.get();
    const mpData = privateSnap.data()?.mercadoPago;

    if (!mpData?.accessToken || !mpData?.userId) {
      return res.status(400).json({ error: 'Mercado Pago no está vinculado' });
    }

    // --- GET /api/mp/pos ---
    if (req.method === 'GET') {
      return res.status(200).json({
        posConfig: mpData.qrConfig || null,
        connected: true
      });
    }

    // --- POST /api/mp/setup-pos ---
    if (req.method === 'POST') {
      const { address, city, state, latitude, longitude } = req.body || {};

      if (!address || !city || !state) {
        return res.status(400).json({ error: 'Faltan datos de ubicación (dirección, ciudad, provincia)' });
      }

      const mpUserId = mpData.userId;
      const externalStoreId = `tenant_${tenantId}`;
      const externalPosId = `tenant_${tenantId}_pos1`;

      // A. Crear o Buscar Sucursal
      let mpStoreId;
      const storePayload = {
        name: "Sucursal Principal",
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

      const storeRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storePayload)
      });

      const storeData = await storeRes.json();

      if (storeRes.ok) {
        mpStoreId = storeData.id;
      } else if (storeData.code === 'store_external_id_already_exists') {
        const search = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores/search?external_id=${externalStoreId}`);
        const searchData = await search.json();
        mpStoreId = searchData.results?.[0]?.id;
      }

      if (!mpStoreId) throw new Error(storeData.message || 'Error al crear sucursal en MP');

      // B. Crear o Buscar Caja (POS)
      let finalPos;
      const posPayload = {
        name: "Caja Principal POS",
        fixed_amount: true,
        external_id: externalPosId,
        external_store_id: externalStoreId,
        category: 621101, // Retail
        config: {
          qr: { operating_mode: "pdv" }
        }
      };

      const posRes = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `setup-pos-${tenantId}`
        },
        body: JSON.stringify(posPayload)
      });

      const posData = await posRes.json();

      if (posRes.ok) {
        finalPos = posData;
      } else if (posData.code === 'pos_external_id_already_exists') {
        const getPos = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos?external_id=${externalPosId}`);
        const getPosData = await getPos.json();
        finalPos = getPosData.results?.[0];
      }

      if (!finalPos || !finalPos.qr) {
        throw new Error(posData.message || 'Error al configurar caja en MP');
      }

      const qrConfig = {
        posId: finalPos.id,
        externalPosId: finalPos.external_id,
        storeId: mpStoreId,
        qrImage: finalPos.qr.image,
        qrTemplate: finalPos.qr.template,
        updatedAt: new Date().toISOString()
      };

      // C. Guardar en Firestore (Transacción)
      await db.runTransaction(async (t) => {
        t.update(privateRef, { 'mercadoPago.qrConfig': qrConfig });

        const publicRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');
        t.set(publicRef, {
          mercadoPagoConfig: {
            habilitado: true, // Aseguramos que quede habilitado
            qrImageUrl: qrConfig.qrImage,
            posExternalId: qrConfig.externalPosId,
            posName: finalPos.name,
            qrConfiguredAt: qrConfig.updatedAt
          }
        }, { merge: true });
      });

      return res.status(200).json(qrConfig);
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (error) {
    console.error('Error en setup-pos:', error);
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
