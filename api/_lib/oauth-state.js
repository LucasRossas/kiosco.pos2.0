import crypto from 'crypto';

const OAUTH_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-oauth-state';

/**
 * Crea un state firmado que contiene el UID del usuario.
 */
export function createOAuthState(uid) {
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutos
  const payload = Buffer.from(JSON.stringify({ uid, expiry })).toString('base64');
  const signature = crypto.createHmac('sha256', OAUTH_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Verifica el state y devuelve el payload si es válido y no expiró.
 */
export function verifyOAuthState(state) {
  try {
    const [payloadBase64, signature] = state.split('.');
    const expectedSignature = crypto.createHmac('sha256', OAUTH_SECRET).update(payloadBase64).digest('hex');

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
    if (Date.now() > payload.expiry) return null;

    return payload;
  } catch (e) {
    return null;
  }
}
