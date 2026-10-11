import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin.js';

/**
 * Helper para asegurar que un pago (Mercado Pago) se procese exactamente una vez.
 * Utiliza una colección 'processed_payments' y transacciones atómicas.
 */

/**
 * Intenta marcar un pago para procesamiento.
 * @param {string} id - Identificador único del pago (payment_id o external_reference)
 * @param {string} commerceId - ID del comercio (tenantId)
 * @param {string} source - Origen del proceso ('webhook' | 'manual' | 'qr_v2')
 * @returns {Promise<{shouldProcess: boolean, status: string, saleId?: string}>}
 */
export async function checkAndMarkProcessing(id, commerceId, source = 'webhook') {
  const db = getAdminDb();
  const paymentRef = db.collection('processed_payments').doc(id);

  try {
    return await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(paymentRef);
      const now = FieldValue.serverTimestamp();
      const data = doc.exists ? doc.data() : null;

      if (doc.exists) {
        // 1. Si ya está completado, no hacer nada. Seguridad absoluta contra duplicados.
        if (data.status === 'completed') {
          return { shouldProcess: false, status: 'completed', saleId: data.saleId };
        }

        // 2. Control de colisión/concurrencia:
        // Si está en 'processing', verificamos si el bloqueo es reciente.
        // Si pasaron más de 5 minutos, asumimos que el proceso anterior murió (ej: reinicio de dyno).
        if (data.status === 'processing') {
          const updatedAt = data.updatedAt?.toDate() || new Date(0);
          const diffMinutes = (Date.now() - updatedAt.getTime()) / 60000;

          if (diffMinutes < 5) {
            return { shouldProcess: false, status: 'processing' };
          }
          console.warn(`[Idempotency] Re-procesando pago ${id} tras timeout de 5 min.`);
        }
      }

      // No existe o falló previamente: marcar como procesando
      transaction.set(paymentRef, {
        status: 'processing',
        commerceId,
        source,
        createdAt: data?.createdAt || now,
        updatedAt: now,
      }, { merge: true });

      return { shouldProcess: true, status: 'processing' };
    });
  } catch (error) {
    console.error(`Error en idempotencia (check): ${id}`, error);
    throw error;
  }
}

/**
 * Libera el bloqueo de procesamiento para permitir que futuras notificaciones
 * vuelvan a intentar la operación (ej: si la notificación actual no tenía pago aprobado).
 */
export async function releaseProcessing(id) {
  const db = getAdminDb();
  try {
    await db.collection('processed_payments').doc(id).delete();
  } catch (error) {
    console.error(`Error liberando idempotencia: ${id}`, error);
  }
}

/**
 * Marca un pago como completado exitosamente.
 * @param {string} id - Identificador único del pago
 * @param {string} saleId - ID de la venta generada en Firestore
 */
export async function markAsCompleted(id, saleId) {
  const db = getAdminDb();
  const paymentRef = db.collection('processed_payments').doc(id);

  await paymentRef.update({
    status: 'completed',
    saleId,
    updatedAt: FieldValue.serverTimestamp()
  });
}

/**
 * Marca un pago como fallido para permitir reintentos posteriores.
 * @param {string} id - Identificador único del pago
 * @param {string} error - Razón del fallo
 */
export async function markAsFailed(id, error) {
  const db = getAdminDb();
  const paymentRef = db.collection('processed_payments').doc(id);

  await paymentRef.update({
    status: 'failed',
    lastError: error instanceof Error ? error.message : String(error),
    updatedAt: FieldValue.serverTimestamp()
  });
}
