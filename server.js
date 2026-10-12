import express from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
/* global process */
const port = process.env.PORT || 3000;

// Security and Proxy configuration
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper to load handlers dynamically
const handle = (modulePath, options = {}) => async (req, res) => {
  try {
    const module = await import(modulePath);
    // Vercel handlers use default export
    const handler = module.default;

    if (options.modifyReq) {
      options.modifyReq(req);
    }

    return handler(req, res);
  } catch (error) {
    console.error(`Error al cargar el módulo ${modulePath}:`, error);
    res.status(503).json({ error: 'Servicio no disponible' });
  }
};

// Mercado Pago OAuth Routes
app.get('/api/mp/oauth/start', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query.action = 'start'; }
}));
app.get('/api/mp/oauth/callback', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query.action = 'callback'; }
}));
app.get('/api/mp/status', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query.action = 'status'; }
}));
app.get('/api/mp/pos', handle('./api/mp-pos.js'));
app.post('/api/mp/setup-pos', handle('./api/mp-pos.js'));
app.post('/api/mp/qr-order', handle('./api/mp-order.js'));

// Vercel Rewrites Mapping (Legacy)
app.all('/api/mercadopago-oauth-state', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query.action = 'start'; }
}));
app.all('/api/mercadopago-callback', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query.action = 'callback'; }
}));
app.all('/api/mercadopago-disconnect', handle('./api/mp-auth.js', {
  modifyReq: (req) => { req.query = { ...req.query, action: 'disconnect' }; }
}));

// Default API Routes
app.all('/api/arca', handle('./api/arca.js'));
app.all('/api/mp-auth', handle('./api/mp-auth.js'));
app.all('/api/system-alerts', handle('./api/system-alerts.js'));
app.all('/api/global-product', handle('./api/global-product.js'));
app.all('/api/confirm-qr-sale', handle('./api/confirm-qr-sale.js'));
app.all('/api/create-subscription', handle('./api/create-subscription.js'));
app.all('/api/mercadopago-webhook', handle('./api/mercadopago-webhook.js'));
app.all('/api/update-subscription', handle('./api/update-subscription.js'));
app.all('/api/mercadopago-qr-webhook', handle('./api/mercadopago-qr-webhook.js'));
app.all('/api/qr-order', handle('./api/qr-order.js'));
app.all('/api/qr-setup', handle('./api/qr-setup.js'));

// Catch-all for undefined API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

const server = app.listen(port, () => {
  console.log(`Servidor Express corriendo en puerto ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Se recibió señal SIGTERM: cerrando servidor HTTP');
  server.close(() => {
    console.log('Servidor HTTP cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Se recibió señal SIGINT: cerrando servidor HTTP');
  server.close(() => {
    console.log('Servidor HTTP cerrado');
    process.exit(0);
  });
});
