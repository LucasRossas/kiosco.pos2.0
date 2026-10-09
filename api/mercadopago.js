import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { round2, lineTotal } from './_lib/money.js';
import { mpFetch } from './_lib/mp-token.js';

const SPECIAL_CATEGORIES = new Set(['Verdulería', 'Fiambrería', 'Carnicería', 'Panadería']);

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const { externalReference, items } = req.body || {};

    if (!externalReference || !/^pos-[\w-]+\d+$/.test(externalReference) || !externalReference.includes(tenantId)) {
      return res.status(400).json({ error: 'Referencia externa inválida' });
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ error: 'Items inválidos' });
    }

    const db = getAdminDb();
    const validatedItems = await Promise.all(items.map(async (item) => {
      const productId = String(item?.productId || '').trim();
      const quantity = Number(item?.quantity);

      if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Item de venta inválido');
      }

      const productSnapshot = await db.collection('tenants').doc(tenantId)
        .collection('products').doc(productId).get();

      if (!productSnapshot.exists) throw new Error('Producto no encontrado');

      const product = productSnapshot.data();
      const unitPrice = Number(product.price);

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error('Precio de producto inválido');
      }

      const tracksStock = product.trackStock === true && !SPECIAL_CATEGORIES.has(product.category);
      const currentStock = Number(product.stock || 0);

      if (tracksStock && currentStock < quantity) {
        throw new Error(`Stock insuficiente para "${product.name}"`);
      }

      const isInteger = Number.isInteger(quantity);
      if (isInteger) {
        return {
          title: String(product.name || 'Producto').substring(0, 45),
          unit_price: round2(unitPrice),
          quantity: quantity,
          currency_id: 'ARS',
        };
      } else {
        const total = lineTotal(unitPrice, quantity);
        const titleSuffix = ` (${quantity.toFixed(3)} kg)`;
        const baseTitle = String(product.name || 'Producto');
        const truncatedTitle = baseTitle.substring(0, 45 - titleSuffix.length);

        return {
          title: (truncatedTitle + titleSuffix).substring(0, 45),
          unit_price: total,
          quantity: 1,
          currency_id: 'ARS',
        };
      }
    }));

    const url = `https://api.mercadopago.com/checkout/preferences`;
    const appOriginApi = process.env.APP_ORIGIN_API || 'https://kiosco-pos-mu.vercel.app';
    const appOrigin = (process.env.APP_ORIGIN || 'https://puntogestionpos.com.ar').split(',')[0].trim();

    const response = await mpFetch(db, tenantId, url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: validatedItems,
        external_reference: externalReference.substring(0, 60),
        notification_url: `${appOriginApi}/api/mercadopago-qr-webhook?tenantId=${tenantId}`,
        back_urls: {
          success: `${appOrigin}/success`,
          failure: `${appOrigin}/failure`,
          pending: `${appOrigin}/pending`
        },
        auto_return: "approved",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('MP API Error:', data);
      return res.status(response.status).json({
        error: 'Error de Mercado Pago al procesar el pago'
      });
    }

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      external_reference: externalReference
    });
  } catch (error) {
    console.error('mercadopago handler error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: status === 500 ? 'Error interno del servidor' : error.message,
    });
  }
}
