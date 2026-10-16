import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

const PLAN_LIMITS = { kiosco: 1, mercado: 3 };

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();
    const { shiftData } = req.body;

    if (!shiftData || !shiftData.id) {
      return res.status(400).json({ error: 'shiftData.id es obligatorio' });
    }

    const result = await db.runTransaction(async (transaction) => {
      // 1. Obtener plan del tenant
      const tenantRef = db.collection('tenants').doc(tenantId);
      const tenantSnap = await transaction.get(tenantRef);

      if (!tenantSnap.exists) {
        throw { status: 404, message: 'Tenant no encontrado' };
      }

      const plan = tenantSnap.data()?.plan || 'kiosco';
      const limit = PLAN_LIMITS[plan] || 1;

      // 2. Contar turnos activos
      const shiftsRef = db.collection('tenants').doc(tenantId).collection('shifts');
      const activeShiftsSnap = await transaction.get(shiftsRef);

      // Filtramos el documento 'state' y contamos los demás que representan cajas/turnos abiertos
      const activeCount = activeShiftsSnap.docs.filter(doc => doc.id !== 'state').length;

      if (activeCount >= limit) {
        throw {
          status: 403,
          code: 'PLAN_LIMIT_REACHED',
          message: `Tu plan ${plan.toUpperCase()} permite hasta ${limit} caja(s) abierta(s) simultáneamente.`
        };
      }

      // 3. Crear el turno y actualizar el tenant para garantizar serialización de la transacción
      const newShiftRef = shiftsRef.doc(shiftData.id);
      transaction.set(newShiftRef, {
        ...shiftData,
        createdAt: new Date(),
        serverValidated: true
      });

      // Actualizar un timestamp en el tenant asegura que si dos peticiones
      // ocurren al mismo tiempo para el mismo tenant, una de las dos fallará y reintentará
      transaction.update(tenantRef, {
        lastShiftOpenedAt: new Date(),
        activeShiftCount: activeCount + 1
      });

      return { plan, limit, activeCount: activeCount + 1 };
    });

    return res.status(200).json({
      success: true,
      ...result
    });

  } catch (err) {
    console.error(`[open-shift] Error:`, err.message || err);
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message || 'Error al abrir el turno',
      code: err.code || 'INTERNAL_ERROR'
    });
  }
}
