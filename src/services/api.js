/**
 * API_BASE_URL se configura mediante variables de entorno (VITE_API_BASE_URL).
 * En desarrollo apunta al servidor Express local (puerto 3000).
 * En producción apunta al servidor Express desplegado en Heroku.
 */

const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL;

  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // Fallback para desarrollo si la variable no está definida
  if (import.meta.env.DEV) {
    return 'http://localhost:3000';
  }

  // Error crítico en producción
  throw new Error('VITE_API_BASE_URL no está definida. Es obligatoria para producción.');
};

export const API_BASE_URL = getApiBaseUrl();
