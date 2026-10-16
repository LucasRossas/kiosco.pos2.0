/**
 * API_BASE_URL es la única fuente de verdad para la URL del backend.
 * En desarrollo apunta a localhost:3000 (o VITE_API_URL si está definida).
 * En producción apunta a la URL de Heroku configurada en VITE_API_URL.
 */

const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;

  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // Fallback según el modo
  if (import.meta.env.DEV) {
    return 'http://localhost:3000';
  }

  // Fallback definitivo para producción (Heroku)
  return 'https://puntogestion-api-bfc2d8f31275.herokuapp.com';
};

export const API_BASE_URL = getApiBaseUrl();
