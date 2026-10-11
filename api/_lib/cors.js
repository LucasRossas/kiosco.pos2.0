export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const appOriginStr = process.env.APP_ORIGIN;

  if (!appOriginStr) {
    console.error('ERROR: APP_ORIGIN no está definida en las variables de entorno.');
    return;
  }

  const allowedOrigins = appOriginStr.split(',').map(o => o.trim());

  if (process.env.APP_ENV !== 'production') {
    allowedOrigins.push('http://localhost:5173');
    allowedOrigins.push('http://localhost:3000');
  }

  res.setHeader('Vary', 'Origin');

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}
