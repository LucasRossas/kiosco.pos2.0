import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';

const MP_API = 'https://api.mercadopago.com';
const PLAN_LIMITS = { kiosco: 1, mercado: 3 };

// ---------- Helpers de Mercado Pago ----------
class MpError extends Error {
  constructor(message, status = 502, code = 'MP_ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Mercado Pago devuelve { paging, results }. Siempre normalizamos a array.
const asArray = (v) => (Array.isArray(v?.results) ? v.results : Array.isArray(v) ? v : []);

const mapStore = (s) => ({
  id: s.id,
  name: String(s.name ?? ''),
  external_id: s.external_id ?? null,
});

const mapPos = (p) => ({
  id: p.id,
  name: String(p.name ?? ''),
  external_id: p.external_id ?? null,
  store_id: p.store_id ?? null,
  qr_image: p.qr?.image ?? null,
});

// ---------- Credenciales y Firestore ----------
async function getMpCredentials(db, tenantId) {
  const snap = await db.collection('private_integrations').doc(tenantId).get();
  const d = snap.data() || {};
  const mpData = d.mercadoPago || {};
  if (!mpData.accessToken || !mpData.userId) {
    throw new MpError('Mercado Pago no está conectado', 400, 'MP_NOT_CONNECTED');
  }
  return { accessToken: mpData.accessToken, userId: mpData.userId, qrConfigs: mpData.qrConfigs || {} };
}

async function savePosLink(db, tenantId, slot, link, mpData, tenantData) {
  const privateRef = db.collection('private_integrations').doc(tenantId);
  const publicRef = db.collection('tenants').doc(tenantId).collection('config').doc('settings');

  const updatedQrConfigs = {
    ...(mpData.qrConfigs || {}),
    [slot]: {
      ...link,
      linkedAt: new Date().toISOString()
    }
  };

  await db.runTransaction(async (t) => {
    t.update(privateRef, {
      'mercadoPago.qrConfigs': updatedQrConfigs,
      'mercadoPago.qrConfig': link // Fallback legacy
    });

    const publicConfigs = {
      ...(tenantData?.mercadoPagoConfig?.qrConfigs || {}),
      [slot]: {
        posName: link.pos_name,
        qrImageUrl: link.qr_image,
        posExternalId: link.external_pos_id
      }
    };

    t.set(publicRef, {
      mercadoPagoConfig: {
        habilitado: true,
        qrImageUrl: link.qr_image,
        posExternalId: link.external_pos_id,
        posName: link.pos_name,
        qrConfiguredAt: new Date().toISOString(),
        qrConfigs: publicConfigs
      }
    }, { merge: true });
  });
}

// ---------- Acciones ----------
async function listStores(db, tenantId, creds) {
  const res = await mpFetch(db, tenantId, `${MP_API}/users/${creds.userId}/stores?limit=100`);
  const data = await res.json();
  if (!res.ok) throw new MpError(data.message || 'Error al listar sucursales', res.status);
  return asArray(data).map(mapStore);
}

async function listPos(db, tenantId, storeId) {
  const res = await mpFetch(db, tenantId, `${MP_API}/pos?store_id=${encodeURIComponent(storeId)}&limit=100`);
  const data = await res.json();
  if (!res.ok) throw new MpError(data.message || 'Error al listar cajas', res.status);
  return asArray(data).map(mapPos);
}

async function createStore(db, tenantId, creds, s) {
  const externalId = `tenant_${tenantId}_suc_principal`;
  try {
    const res = await mpFetch(db, tenantId, `${MP_API}/users/${creds.userId}/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: s.name,
        external_id: externalId,
        location: {
          street_name: s.address,
          street_number: '0', // Requerido por MP
          city_name: s.city,
          state_name: s.state,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
        },
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.message?.includes('already assigned')) {
        const stores = await listStores(db, tenantId, creds);
        return stores.find(x => x.external_id === externalId);
      }
      throw new MpError(data.message || 'Error al crear sucursal', res.status);
    }
    return mapStore(data);
  } catch (err) {
    if (err instanceof MpError) throw err;
    const stores = await listStores(db, tenantId, creds);
    const existing = stores.find((x) => x.external_id === externalId);
    if (existing) return existing;
    throw err;
  }
}

async function findOrCreatePos(db, tenantId, slot, store) {
  const externalId = `tenant_${tenantId}_caja_${slot}`;
  const current = await listPos(db, tenantId, store.id);
  const existing = current.find((p) => p.external_id === externalId);
  if (existing) return existing;

  try {
    const res = await mpFetch(db, tenantId, `${MP_API}/pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Caja ${slot}`,
        fixed_amount: false,
        external_id: externalId,
        store_id: store.id,
        external_store_id: store.external_id,
        category: 621101, // Retail
        config: { qr: { operating_mode: "pdv" } }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.message?.includes('already assigned')) {
        const retry = (await listPos(db, tenantId, store.id)).find((p) => p.external_id === externalId);
        if (retry) return retry;
      }
      throw new MpError(data.message || 'Error al crear caja', res.status);
    }
    return mapPos(data);
  } catch (err) {
    if (err instanceof MpError) throw err;
    const retry = (await listPos(db, tenantId, store.id)).find((p) => p.external_id === externalId);
    if (retry) return retry;
    throw err;
  }
}

async function setup(db, tenantId, plan, creds, body) {
  const { mode, slot: rawSlot, posIndex, storeId, posId, store: storeData } = body || {};
  const maxPos = PLAN_LIMITS[plan] ?? 1;
  const slot = Number(rawSlot || posIndex) || 1;

  if (slot < 1 || slot > maxPos) {
    throw new MpError(`Tu plan ${plan.toUpperCase()} permite hasta ${maxPos} caja(s).`, 403, 'PLAN_LIMIT');
  }

  let store;
  let pos;

  if (mode === 'create') {
    const s = storeData || {};
    if (!s.name || !s.address || !s.city || !s.state || !s.latitude || !s.longitude) {
      throw new MpError('Completá todos los datos de ubicación.', 400, 'INVALID_INPUT');
    }
    store = await createStore(db, tenantId, creds, s);
    pos = await findOrCreatePos(db, tenantId, slot, store);
  } else if (mode === 'map') {
    // Aceptamos tanto ids numéricos como external_ids si viniera de un select que mapee eso
    if (!storeId || !posId) throw new MpError('Elegí sucursal y caja.', 400, 'INVALID_INPUT');

    const stores = await listStores(db, tenantId, creds);
    store = stores.find((x) => String(x.id) === String(storeId));
    if (!store) throw new MpError('Sucursal no encontrada.', 404, 'STORE_NOT_FOUND');

    const pos_list = await listPos(db, tenantId, store.id);
    pos = pos_list.find((p) => String(p.id) === String(posId));
    if (!pos) throw new MpError('Caja no encontrada.', 404, 'POS_NOT_FOUND');
  } else {
    throw new MpError('Modo no válido.', 400, 'INVALID_INPUT');
  }

  if (!pos.qr_image) {
    const res = await mpFetch(db, tenantId, `${MP_API}/pos/${pos.id}`);
    const updatedPos = await res.json();
    pos.qr_image = updatedPos.qr?.image;
    if (!pos.qr_image) throw new MpError('La caja no tiene un código QR generado.', 500, 'NO_QR');
  }

  const link = {
    store_id: store.id,
    pos_id: pos.id,
    external_pos_id: pos.external_id || `tenant_${tenantId}_caja_${slot}`,
    pos_name: pos.name,
    qr_image: pos.qr_image,
  };

  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  await savePosLink(db, tenantId, slot, link, creds, tenantSnap.data());

  return {
    storeId: store.id,
    storeName: store.name,
    posId: pos.id,
    externalPosId: link.external_pos_id,
    posName: pos.name,
    qrImage: link.qr_image,
    slot,
  };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const plan = tenantSnap.data()?.plan || 'kiosco';

    const creds = await getMpCredentials(db, tenantId);
    const action = req.query.action;

    if (req.method === 'GET' && action === 'list-stores') {
      return res.status(200).json(await listStores(db, tenantId, creds));
    }

    if (req.method === 'GET' && action === 'list-pos') {
      if (!req.query.store_id) throw new MpError('Falta store_id', 400, 'INVALID_INPUT');
      return res.status(200).json(await listPos(db, tenantId, req.query.store_id));
    }

    if (req.method === 'GET' && action === 'test') {
      const { pos_id } = req.query;
      if (!pos_id) throw new MpError('Falta pos_id', 400, 'INVALID_INPUT');
      const resMp = await mpFetch(db, tenantId, `${MP_API}/pos/${encodeURIComponent(pos_id)}`);
      const data = await resMp.json();
      if (!resMp.ok) throw new MpError(data.message || 'Error al verificar POS', resMp.status);
      return res.status(200).json({ name: String(data.name ?? '') });
    }

    if (req.method === 'POST' && action === 'setup') {
      const result = await setup(db, tenantId, plan, creds, req.body);
      return res.status(200).json(result);
    }

    throw new MpError('Acción o método no válido', 400, 'BAD_REQUEST');
  } catch (err) {
    const status = err.status && err.status < 600 ? err.status : 500;
    console.error('[mp/setup-pos]', err.code || 'ERR', err.message);
    return res.status(status).json({
      error: String(err.message || 'Error inesperado'),
      code: err.code || 'INTERNAL'
    });
  }
}
