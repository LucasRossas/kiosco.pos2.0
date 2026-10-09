import crypto from 'node:crypto';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  const secret = process.env.MP_OAUTH_STATE_SECRET;
  if (!secret) throw new Error('MP_OAUTH_STATE_SECRET no configurado');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createOAuthState(uid) {
  const payload = encode({ uid, exp: Date.now() + 10 * 60 * 1000 });
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(state) {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature) throw new Error('state OAuth inválido');
  const expected = sign(payload);
  const valid = signature.length === expected.length && crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
  if (!valid) throw new Error('state OAuth inválido');

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.uid || !Number.isFinite(data.exp) || data.exp < Date.now()) {
    throw new Error('state OAuth expirado');
  }
  return data;
}
