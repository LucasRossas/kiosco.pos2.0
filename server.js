import express from 'express';
import dotenv from 'dotenv';
import { setCorsHeaders, handleOptions } from './api/_lib/cors.js';

// Load environment variables
dotenv.config();

const app = express();
/* global process */
const port = process.env.PORT || 3000;

// Security and Proxy configuration
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// --- CONFIGURACIÓN DE RUTAS API ---
const apiRouter = express.Router({
  strict: false,
  caseSensitive: false
});

// Debug middleware para trazar rutas en producción (Heroku)
apiRouter.use((req, res, next) => {
  console.log(`[DEBUG API] ${req.method} ${req.path}`);
  next();
});

// Middleware de CORS para todas las rutas del router
apiRouter.use((req, res, next) => {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  next();
});

// Helper to load handlers dynamically
const handle = (modulePath, options = {}) => async (req, res) => {
  try {
    const module = await import(modulePath);
    const handler = module.default;

    if (!handler) {
      throw new Error(`Módulo ${modulePath} no tiene exportación por defecto`);
    }

    if (options.modifyReq) {
      options.modifyReq(req);
    }

    // El await es CRUCIAL para capturar errores asíncronos y enviarlos al catch
    return await handler(req, res);
  } catch (error) {
    console.error(`[HANDLER ERROR] ${modulePath}:`, error);
    const status = error.status || error.statusCode || 500;
    res.status(status).json({
      error: 'Error en el servidor API',
      message: error.message,
      path: req.originalUrl,
      module: modulePath
    });
  }
};

// Mapeo explícito de rutas para asegurar consistencia
const routes = [
  { path: '/mp-auth', module: './api/mp-auth.js' },
  {
    path: '/mp/oauth/callback',
    module: './api/mp-auth.js',
    options: { modifyReq: (req) => { req.query.action = 'callback'; } }
  },
  { path: '/mp-setup-pos', module: './api/setup-pos.js' },
  { path: '/arca', module: './api/arca.js' },
  { path: '/system-alerts', module: './api/system-alerts.js' },
  { path: '/global-product', module: './api/global-product.js' },
  { path: '/confirm-qr-sale', module: './api/confirm-qr-sale.js' },
  { path: '/create-subscription', module: './api/create-subscription.js' },
  { path: '/mercadopago-webhook', module: './api/mercadopago-webhook.js' },
  { path: '/update-subscription', module: './api/update-subscription.js' },
  { path: '/mercadopago-qr-webhook', module: './api/mercadopago-qr-webhook.js' },
  { path: '/qr-order', module: './api/qr-order.js' }
];

routes.forEach(route => {
  apiRouter.all(route.path, handle(route.module));
});

// Catch-all para rutas API no definidas (dentro de /api)
apiRouter.all('*', (req, res) => {
  console.warn('[404 API]', req.method, req.originalUrl, 'RouterPath:', req.path);
  res.status(404).json({
    error: 'Endpoint no encontrado',
    path: req.path,
    routerPath: req.path,
    method: req.method
  });
});

// Montar el Router en /api
app.use('/api', apiRouter);

// Health Check (Fuera del router de API)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'production'
  });
});

// Catch-all global para depuración (rutas que no empiezan con /api)
app.use((req, res) => {
  console.warn('[404 GLOBAL]', req.method, req.originalUrl);
  res.status(404).json({
    error: 'Ruta global no encontrada',
    path: req.originalUrl
  });
});

const server = app.listen(port, () => {
  console.log(`Servidor Express corriendo en puerto ${port} (Modo: ${process.env.NODE_ENV || 'production'})`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`Se recibió señal ${signal}: cerrando servidor HTTP`);
  server.close(() => {
    console.log('Servidor HTTP cerrado');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
