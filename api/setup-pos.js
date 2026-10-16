import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';

const MP_API = 'https://api.mercadopago.com';
const PLAN_LIMITS = { kiosco: 1, mercado: 3 };

class MpError extends Error {
  constructor(message, status = 502, code = 'MP_ERROR', details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const asArray = (v) => (Array.isArray(v?.results) ? v.results : Array.isArray(v) ? v : []);

async function getMpCredentials(db, tenantId) {
  const snap = await db.collection('private_integrations').doc(tenantId).get();
  const mpData = snap.data()?.mercadoPago;

  if (!snap.exists || !mpData?.accessToken || !mpData?.userId) {
    throw new MpError('Mercado Pago no vinculado', 409, 'MP_NOT_CONNECTED');
  }
  return { accessToken: mpData.accessToken, userId: mpData.userId };
}

async function safeMpFetch(db, tenantId, creds, url, options = {}, customErrorMsg) {
  const method = options.method || 'GET';
  // No se loguean creds ni tokens, solo presencia
  console.log(`[MP-CALL] ${method} ${url}`);

  const response = await mpFetch(db, tenantId, url, options);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  // Registro solicitado: status, content-type y primeros 200 caracteres
  console.log(`[MP-RESPONSE] Status: ${response.status} | Type: ${contentType} | Body: ${text.substring(0, 200)}`);

  if (!contentType.includes('application/json')) {
    throw new MpError(`Respuesta no JSON de Mercado Pago (Status: ${response.status})`, 502, 'INVALID_CONTENT_TYPE', {
      contentType,
      bodyPreview: text.substring(0, 200)
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    console.error('[PARSE ERROR] Fallo al parsear JSON de MP:', parseErr, text.substring(0, 100));
    throw new MpError('Error al parsear JSON de Mercado Pago', 502, 'PARSE_ERROR');
  }

  if (!response.ok) {
    throw new MpError(customErrorMsg || data.message || 'Error en MP', response.status, 'MP_API_ERROR', { mpData: data });
  }

  return data;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  const action = req.query.action;

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();

    // 1. Validar Credenciales
    const creds = await getMpCredentials(db, tenantId);

    // --- ACCIÓN: Listar Sucursales ---
    if (req.method === 'GET' && action === 'list-stores') {
      const data = await safeMpFetch(db, tenantId, creds, `${MP_API}/users/${creds.userId}/stores/search`, {}, 'Error en MP al listar sucursales');

      const stores = asArray(data).map(s => ({
        id: s.id,
        name: s.name || `Sucursal ${s.id}`,
        external_id: s.external_id
      }));
      return res.status(200).json(stores);
    }

    // --- ACCIÓN: Listar Cajas de una sucursal ---
    if (req.method === 'GET' && action === 'list-pos') {
      const { store_id } = req.query;
      if (!store_id || !/^\d+$/.test(String(store_id))) throw new MpError('store_id inválido (solo dígitos)', 400);

      const data = await safeMpFetch(db, tenantId, creds, `${MP_API}/pos?store_id=${store_id}&limit=100`, {}, 'Error en MP al listar cajas');

      const posList = asArray(data).map(p => ({
        id: p.id,
        name: p.name || `Caja ${p.id}`,
        external_id: p.external_id
      }));
      return res.status(200).json(posList);
    }

    // --- ACCIÓN: Test de Conexión ---
    if (req.method === 'GET' && action === 'test') {
      const { pos_id } = req.query;
      if (!pos_id || !/^\d+$/.test(String(pos_id))) throw new MpError('pos_id inválido (solo dígitos)', 400);
      const data = await safeMpFetch(db, tenantId, creds, `${MP_API}/pos/${pos_id}`, {}, 'No se pudo verificar la caja');
      return res.status(200).json(data);
    }

    // --- ACCIÓN: Configuración (Setup) ---
    if (req.method === 'POST' && action === 'setup') {
      const { mode, posData, posIndex } = req.body;

      // Validar límites de plan
      const tenantSnap = await db.collection('tenants').doc(tenantId).get();
      const plan = tenantSnap.data()?.plan || 'kiosco';
      const limit = PLAN_LIMITS[plan] || 1;

      const pIdx = parseInt(posIndex);
      if (isNaN(pIdx) || pIdx < 1 || pIdx > limit) {
        throw new MpError(`Tu plan ${plan.toUpperCase()} solo permite configurar hasta ${limit} caja(s).`, 403, 'PLAN_LIMIT_REACHED');
      }

      let finalPos;

      if (mode === 'map') {
        if (!posData?.id || !/^\d+$/.test(String(posData.id))) {
          throw new MpError('posData.id inválido (solo dígitos)', 400);
        }
        // Vincular existente
        finalPos = await safeMpFetch(db, tenantId, creds, `${MP_API}/pos/${posData.id}`, {}, 'La caja seleccionada no es válida');

        // REQUISITO: Si no tiene external_id válido, hay que asignarle uno para que funcione QR V2
        const currentExtId = String(finalPos.external_id || '').trim();
        if (!currentExtId || currentExtId === 'undefined' || currentExtId === 'null') {
          const safeUid = tenantId.replace(/[^a-zA-Z0-9]/g, '');
          const newExternalId = `pos${safeUid}${pIdx}`.substring(0, 40);
          console.log(`[setup-pos] Asignando external_id faltante: ${newExternalId} a POS ${finalPos.id}`);

          await safeMpFetch(db, tenantId, creds, `${MP_API}/pos/${finalPos.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ external_id: newExternalId })
          }, 'Error al asignar ID externo a la caja en Mercado Pago');

          finalPos.external_id = newExternalId;
        }
      } else if (mode === 'create') {
        const storeData = req.body.storeData || req.body;
        const { address, city, state, latitude, longitude } = storeData;
        const safeUid = tenantId.replace(/[^a-zA-Z0-9]/g, '');
        const externalStoreId = `store${safeUid}${pIdx}`.substring(0, 40);
        const externalPosId = `pos${safeUid}${pIdx}`.substring(0, 40);

        // 1. Buscar o Crear Sucursal
        const storeSearch = await safeMpFetch(db, tenantId, creds, `${MP_API}/users/${creds.userId}/stores/search?external_id=${externalStoreId}`);
        let mpStore = asArray(storeSearch)[0];

        if (!mpStore) {
          if (!address || !city || !state) {
            throw new MpError('Para crear una sucursal se requiere address, city y state', 400);
          }
          const storePayload = {
            name: `Sucursal ${pIdx}`,
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
          mpStore = await safeMpFetch(db, tenantId, creds, `${MP_API}/users/${creds.userId}/stores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(storePayload)
          }, 'Error al crear la sucursal');
        }

        // 2. Buscar o Crear Caja (POS)
        const posSearch = await safeMpFetch(db, tenantId, creds, `${MP_API}/pos?external_id=${externalPosId}`);
        finalPos = asArray(posSearch)[0];

        if (!finalPos) {
          const posPayload = {
            name: `Caja ${pIdx}`,
            fixed_amount: true,
            store_id: mpStore.id,
            external_id: externalPosId
          };
          finalPos = await safeMpFetch(db, tenantId, creds, `${MP_API}/pos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(posPayload)
          }, 'Error al crear la caja');
        }
      } else {
        throw new MpError('Modo no válido', 400);
      }

      const finalExtId = String(finalPos.external_id || '').trim();

      const qrConfig = {
        posId: String(finalPos.id),
        externalPosId: finalExtId,
        storeId: String(finalPos.store_id),
        qrImageUrl: finalPos.qr?.image || '',
        posName: finalPos.name || `Caja ${pIdx}`
      };

      // Validación final para evitar estados corruptos
      if (!qrConfig.externalPosId || qrConfig.externalPosId === 'undefined' || qrConfig.externalPosId === 'null') {
        throw new MpError('La caja de Mercado Pago no tiene un ID externo válido y no pudo ser asignado automáticamente.', 500, 'INVALID_EXTERNAL_POS_ID');
      }

      // Guardar en Firestore conforme al CONTRATO
      await db.runTransaction(async (transaction) => {
        const privateRef = db.collection('private_integrations').doc(tenantId);
        const publicRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');

        // Usamos notación de punto para actualizar solo la caja específica y preservar las demás
        transaction.update(privateRef, {
          [`mercadoPago.qrConfigs.${pIdx}`]: qrConfig
        });

        transaction.update(publicRef, {
          [`mercadoPagoConfig.qrConfigs.${pIdx}`]: qrConfig
        });
      });

      return res.status(200).json(qrConfig);
    }

    throw new MpError('Acción no implementada', 404);

  } catch (err) {
    console.error(`[setup-pos] Error:`, err.message);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'Error interno en el servidor',
      code: err.code || 'INTERNAL_ERROR',
      ...err.details
    });
  }
}
