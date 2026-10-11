import { getFirebaseAuth } from './firebase';
import { API_BASE_URL } from './api';

async function getAuthorizationHeaders() {
  const token = await getFirebaseAuth()?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesión de Firebase requerida');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Cambia el plan de suscripción en Mercado Pago y Firestore (Client-Side).
 * Maneja Upgrade (inmediato) y Downgrade (programado).
 */
export async function changeSubscriptionPlan(tenantId, currentPlan, targetPlan, subscriptionId) {
  if (!subscriptionId) throw new Error('No se encontró ID de suscripción activa.');

  // 1. Actualizar Mercado Pago vía servidor del backend
  const mpResponse = await fetch(`${API_BASE_URL}/api/update-subscription`, {
    method: 'POST',
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify({
      subscriptionId,
        operation: 'change-plan',
        targetPlan
    })
  });

  if (!mpResponse.ok) {
    const errorData = await mpResponse.json();
    throw new Error(errorData.error || errorData.message || 'Error al actualizar suscripción en Mercado Pago');
  }

  const data = await mpResponse.json();
  return { isUpgrade: data.isUpgrade, downgradeDate: data.downgradeDate };
}

/**
 * Cancela definitivamente una suscripción en Mercado Pago.
 */
export async function cancelSubscription(subscriptionId) {
  if (!subscriptionId) return true;

  const mpResponse = await fetch(`${API_BASE_URL}/api/update-subscription`, {
    method: 'POST',
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify({
      subscriptionId,
        operation: 'cancel'
    })
  });

  if (!mpResponse.ok) {
    const errorData = await mpResponse.json();
    throw new Error(errorData.message || 'Error al cancelar la suscripción en Mercado Pago');
  }

  return true;
}
