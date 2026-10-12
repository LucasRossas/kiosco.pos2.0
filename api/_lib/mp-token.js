/**
 * Manejo de Access Token de Mercado Pago con soporte para Refresh Token automático.
 * Implementa bloqueos atómicos en Firestore para evitar condiciones de carrera durante la renovación.
 */

export async function getMercadoPagoAccessToken(db, tenantId) {
  const privateRef = db.collection('private_integrations').doc(tenantId);
  const privateSnap = await privateRef.get();
  const mpData = privateSnap.data()?.mercadoPago;

  if (!mpData?.accessToken) {
    throw { statusCode: 409, message: 'Mercado Pago no está vinculado' };
  }

  // Si vence en menos de 7 días y tenemos refresh token, renovar
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const isExpired = mpData.expiresAt && (Date.now() + sevenDays > mpData.expiresAt);

  if (isExpired && mpData.refreshToken) {
    return await refreshMPToken(db, tenantId, mpData.refreshToken);
  }

  return mpData.accessToken;
}

async function refreshMPToken(db, tenantId, oldRefreshToken) {
  const privateRef = db.collection('private_integrations').doc(tenantId);
  const lockDuration = 30000; // 30 segundos de lock

  try {
    // 1. Intentar adquirir el bloqueo de renovación atómicamente
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(privateRef);
      const data = doc.data()?.mercadoPago;

      // Si el token ya fue renovado por otro proceso
      if (data.refreshToken !== oldRefreshToken) {
        return { action: 'use_new', token: data.accessToken };
      }

      // Si hay un proceso de renovación en curso (lock activo)
      if (data.refreshingUntil && data.refreshingUntil > Date.now()) {
        return { action: 'wait' };
      }

      // Adquirir el lock
      transaction.update(privateRef, {
        'mercadoPago.refreshingUntil': Date.now() + lockDuration
      });
      return { action: 'refresh' };
    });

    if (result.action === 'use_new') return result.token;
    if (result.action === 'wait') {
      // Esperar 2 segundos y reintentar obtener el token (ya debería estar renovado)
      await new Promise(resolve => setTimeout(resolve, 2000));
      const freshSnap = await privateRef.get();
      return freshSnap.data()?.mercadoPago?.accessToken;
    }

    // 2. Ejecutar la renovación (fuera de la transacción de Firestore)
    const { MP_CLIENT_ID, MP_CLIENT_SECRET } = process.env;
    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: oldRefreshToken,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error renovando token para ${tenantId}:`, data);

      // Liberar el lock en caso de error para permitir reintentos posteriores
      await privateRef.update({ 'mercadoPago.refreshingUntil': 0 });

      // Si el refresh token es inválido, deshabilitar integración
      if (data.error === 'invalid_grant') {
        await db.collection('tenants').doc(tenantId).collection('config').doc('settings').set({
          mercadoPagoConfig: { habilitado: false }
        }, { merge: true });
        throw { statusCode: 409, message: 'La conexión con Mercado Pago expiró. Reconectá desde Configuración.' };
      }
      throw { statusCode: 500, message: 'Error al renovar token de Mercado Pago' };
    }

    const expiresAt = Date.now() + (data.expires_in * 1000);
    const newAccessToken = data.access_token;

    // 3. Guardar nuevo token y liberar el lock
    await privateRef.update({
      'mercadoPago.accessToken': newAccessToken,
      'mercadoPago.refreshToken': data.refresh_token,
      'mercadoPago.expiresAt': expiresAt,
      'mercadoPago.updatedAt': new Date().toISOString(),
      'mercadoPago.refreshingUntil': 0
    });

    return newAccessToken;
  } catch (error) {
    console.error('Refresh Token Exception:', error);
    throw error;
  }
}

export async function mpFetch(db, tenantId, url, options = {}) {
  let token = await getMercadoPagoAccessToken(db, tenantId);

  const makeRequest = async (tokenToUse) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${tokenToUse}`,
    };
    return fetch(url, { ...options, headers });
  };

  let response = await makeRequest(token);

  // Si da 401, forzar una renovación sin importar la fecha de expiración guardada
  if (response.status === 401) {
    const privateSnap = await db.collection('private_integrations').doc(tenantId).get();
    const mpData = privateSnap.data()?.mercadoPago;
    if (mpData?.refreshToken) {
      token = await refreshMPToken(db, tenantId, mpData.refreshToken);
      response = await makeRequest(token);
    }
  }

  return response;
}

