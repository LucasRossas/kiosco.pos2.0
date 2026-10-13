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

      // A. Buscar o Crear Sucursal
      let mpStoreId;

      // 1. Intentar buscar primero por external_id
      const searchStore = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores/search?external_id=${externalStoreId}`);
      const searchStoreData = await searchStore.json();

      if (searchStore.ok && searchStoreData.results?.length > 0) {
        mpStoreId = searchStoreData.results[0].id;
        console.log(`Sucursal encontrada: ${mpStoreId}`);
      } else {
        // 2. Si no existe, crearla
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
        } else if (storeData.message?.includes('already assigned')) {
          // Re-intento de búsqueda por si hubo una race condition
          const retry = await mpFetch(db, tenantId, `https://api.mercadopago.com/users/${mpUserId}/stores/search?external_id=${externalStoreId}`);
          const retryData = await retry.json();
          mpStoreId = retryData.results?.[0]?.id;
        }
      }

      if (!mpStoreId) throw new Error('No se pudo determinar el ID de la sucursal en Mercado Pago.');

      // B. Buscar o Crear Caja (POS)
      let finalPos;

      // 1. Intentar buscar primero por external_id
      const searchPos = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos?external_id=${externalPosId}`);
      const searchPosData = await searchPos.json();

      if (searchPos.ok && searchPosData.results?.length > 0) {
        finalPos = searchPosData.results[0];
        console.log(`Caja encontrada: ${finalPos.id}`);
      } else {
        // 2. Si no existe, crearla
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
        } else if (posData.message?.includes('already assigned')) {
          const retryPos = await mpFetch(db, tenantId, `https://api.mercadopago.com/pos?external_id=${externalPosId}`);
          const retryPosData = await retryPos.json();
          finalPos = retryPosData.results?.[0];
        }
      }

      if (!finalPos || !finalPos.qr) {
        throw new Error('Error al configurar o recuperar la caja en Mercado Pago.');
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
