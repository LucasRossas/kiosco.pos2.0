/**
 * Utilidades para hashing de contraseñas usando el estándar Web Crypto API (PBKDF2).
 * Esta implementación es puramente del lado del cliente.
 */

const ITERATIONS = 210000;
const SALT_LENGTH = 16;
const HASH_ALGO = 'SHA-256';

/**
 * Genera un hash a partir de una contraseña en texto plano.
 * @param {string} password
 * @returns {Promise<{hash: string, salt: string, iterations: number}>}
 */
export async function hashPassword(password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await deriveKey(password, salt, ITERATIONS);

  return {
    hash: bufToHex(hash),
    salt: bufToHex(salt),
    iterations: ITERATIONS
  };
}

/**
 * Verifica si una contraseña coincide con el registro guardado.
 * @param {string} password Contraseña ingresada
 * @param {Object} record Objeto con {hash, salt, iterations}
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, record) {
  if (!record || !record.hash || !record.salt) return false;

  const salt = hexToBuf(record.salt);
  const iterations = record.iterations || ITERATIONS;
  const derivedHash = await deriveKey(password, salt, iterations);

  return bufToHex(derivedHash) === record.hash;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: HASH_ALGO
    },
    keyMaterial,
    256 // length in bits
  );
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
