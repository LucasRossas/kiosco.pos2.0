export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const appOriginStr = process.env.APP_ORIGIN || 'https://puntogestionpos.com.ar';
  const allowedOrigins = appOriginStr.split(',').map(o => o.trim());

  if (process.env.VERCEL_ENV !== 'production') {
    allowedOrigins.push('http://localhost:5173');
  }

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || 'null');
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

export function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  const appOriginStr = process.env.APP_ORIGIN || 'https://puntogestionpos.com.ar';
  const allowedOrigins = appOriginStr.split(',').map(o => o.trim());

  if (process.env.VERCEL_ENV !== 'production') {
    allowedOrigins.push('http://localhost:5173');
  }

  return (origin && allowedOrigins.includes(origin)) ? origin : (allowedOrigins[0] || 'null');
}
