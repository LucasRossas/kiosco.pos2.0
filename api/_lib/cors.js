export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const appOriginStr = process.env.APP_ORIGIN || '';

  // Normalizar: quitar espacios y barras finales
  const allowedOrigins = appOriginStr
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // En producción también permitimos la versión con www
  if (process.env.APP_ENV === 'production') {
    const wwwOrigins = allowedOrigins
      .filter(o => o.startsWith('https://') && !o.includes('www.'))
      .map(o => o.replace('https://', 'https://www.'));
    allowedOrigins.push(...wwwOrigins);
  }

  // En desarrollo agregamos localhost
  if (process.env.APP_ENV !== 'production') {
    allowedOrigins.push(
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000'
    );
  }

  res.setHeader('Vary', 'Origin');

  const normalizedOrigin = origin ? origin.replace(/\/$/, '') : null;

  if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin && process.env.APP_ENV !== 'production') {
    // Solo para Postman / curl en desarrollo
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin) {
    // Log útil para debuggear en producción
    console.warn(`[CORS] Origin no permitido: ${origin}`);
    console.warn(`[CORS] Orígenes permitidos:`, allowedOrigins);
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, X-Idempotency-Key'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}