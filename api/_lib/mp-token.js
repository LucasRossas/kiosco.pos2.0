/**
 * Manejo de Access Token de Mercado Pago con soporte para Refresh Token automático
 */

export async function getMercadoPagoAccessToken(db, tenantId) {
  const privateRef = db.collection('private_integrations').doc(tenantId);
  const privateSnap = await privateRef.get();
  const mpData = privateSnap.data()?.mercadoPago;

  if (!mpData?.accessToken || !mpData?.refreshToken) {
    throw { statusCode: 409, message: 'Mercado Pago no está vinculado' };
  }

  // Si vence en menos de 7 días, renovar
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const isExpired = mpData.expiresAt && (Date.now() + sevenDays > mpData.expiresAt);

  if (isExpired) {
    return await refreshMPToken(db, tenantId, mpData.refreshToken);
  }

  return mpData.accessToken;
}

async function refreshMPToken(db, tenantId, refreshToken) {
  try {
    const { MP_CLIENT_ID, MP_CLIENT_SECRET } = process.env;
    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error renovando token para ${tenantId}:`, data);
      // Deshabilitar la integración si el refresh falla
      await db.collection('tenants').doc(tenantId).collection('config').doc('settings').set({
        mercadoPagoConfig: { habilitado: false }
      }, { merge: true });
      throw { statusCode: 409, message: 'La conexión con Mercado Pago expiró. Reconectá desde Configuración.' };
    }

    const expiresAt = Date.now() + (data.expires_in * 1000);
    const newAccessToken = data.access_token;

    await db.collection('private_integrations').doc(tenantId).set({
      mercadoPago: {
        accessToken: newAccessToken,
        refreshToken: data.refresh_token,
        expiresAt,
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });

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

  if (response.status === 401) {
    const privateSnap = await db.collection('private_integrations').doc(tenantId).get();
    const refreshToken = privateSnap.data()?.mercadoPago?.refreshToken;
    if (refreshToken) {
      token = await refreshMPToken(db, tenantId, refreshToken);
      response = await makeRequest(token);
    }
  }

  return response;
}
