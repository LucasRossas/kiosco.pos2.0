import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { round2, lineTotal } from './_lib/money.js';
import { mpFetch } from './_lib/mp-token.js';
import { isStockTracked } from './_lib/stock.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const { action, posIndex, externalReference, items, idempotencyKey, shiftId, cashier } = req.body || {};
    const db = getAdminDb();

    // 1. Obtener credenciales de Mercado Pago y configuración de POS
    const privateRef = db.collection('private_integrations').doc(tenantId);
    const privateSnap = await privateRef.get();
    const mpData = privateSnap.data()?.mercadoPago;

    if (!mpData?.accessToken || !mpData?.userId) {
      return res.status(400).json({ error: 'Mercado Pago no está vinculado' });
    }

    const qrConfigs = mpData.qrConfigs || {};
    const idx = parseInt(posIndex);
    if (isNaN(idx) || !qrConfigs[idx]) {
      return res.status(400).json({ error: 'Configuración de POS no encontrada' });
    }
    const posExternalId = qrConfigs[idx].externalPosId;
    if (!posExternalId) {
      return res.status(400).json({ error: 'ID externo de POS no encontrado en la configuración' });
    }

    const mpUserId = mpData.userId;
    const refRegex = new RegExp(`^pos-${tenantId}-\\d+$`);

    if (action === 'create') {
      // Validar externalReference
      if (!externalReference || !refRegex.test(externalReference)) {
        return res.status(400).json({ error: 'Referencia externa inválida. Debe ser pos-<uid>-<timestamp>' });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La orden debe tener al menos un ítem' });
      }

      // Validar stock y calcular total desde la base
      const tenantSnap = await db.collection('tenants').doc(tenantId).get();
      const tenantRef = db.collection('tenants').doc(tenantId);
      const productRefs = items.map(item => tenantRef.collection('products').doc(item.productId));
      const productSnaps = await Promise.all(productRefs.map(ref => ref.get()));

      let calculatedTotal = 0;
      const mpItems = [];
      const normalizedItems = [];

      for (let i = 0; i < items.length; i++) {
        const snap = productSnaps[i];
        if (!snap.exists) {
          return res.status(400).json({ error: `Producto no encontrado: ${items[i].productId}` });
        }

        const product = snap.data();
        const quantity = Number(items[i].quantity);
        const price = Number(product.price);
        const trackStock = isStockTracked(product);

        if (trackStock && product.stock !== null && product.stock < quantity) {
          return res.status(400).json({ error: `Stock insuficiente para ${product.name}` });
        }

        const itemTotal = lineTotal(price, quantity);
        calculatedTotal += itemTotal;

        normalizedItems.push({
          productId: snap.id,
          name: product.name,
          quantity,
          price,
          trackStock
        });

        mpItems.push({
          sku_number: snap.id,
          category: product.category || 'General',
          title: product.name,
          description: product.name,
          unit_price: price,
          quantity: quantity,
          unit_measure: 'unit',
          total_amount: itemTotal
        });
      }

      calculatedTotal = round2(calculatedTotal);
      const expires = new Date(Date.now() + 10 * 60000).toISOString();

      // V2 Order Model: PUT /instore/qr/seller/collectors/{collector_id}/pos/{external_pos_id}/orders
      const url = `https://api.mercadopago.com/instore/qr/seller/collectors/${mpUserId}/pos/${posExternalId}/orders`;

      if (!process.env.APP_ORIGIN_API) {
        return res.status(500).json({ error: 'Error de configuración: APP_ORIGIN_API no definida' });
      }

      const orderPayload = {
        external_reference: externalReference,
        title: "Venta POS",
        description: `Venta desde Punto de Gestión - ${tenantId}`,
        notification_url: `${process.env.APP_ORIGIN_API}/api/mercadopago-qr-webhook?tenantId=${tenantId}`,
        expiration_date: expires,
        total_amount: calculatedTotal,
        items: mpItems
      };

      const mpRes = await mpFetch(db, tenantId, url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey || `create-${tenantId}-${externalReference}`
        },
        body: JSON.stringify(orderPayload)
      });

      if (!mpRes.ok) {
        const mpResult = await mpRes.json();
        console.error('MP V2 Create Order Error:', mpResult);
        return res.status(400).json({ error: mpResult.message || 'Error al asignar la orden a la caja' });
      }

      const orderDoc = {
        tenantId,
        posExternalId,
        externalReference,
        amount: calculatedTotal,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: expires,
        saleMetadata: {
          items: normalizedItems,
          shiftId: shiftId || null,
          cashier: cashier || null,
          storeName: tenantSnap.data()?.storeName || 'Mi Comercio'
        }
      };

      // Guardar en el índice global (para el webhook)
      await db.collection('qr_order_index').doc(externalReference).set({
        tenantId,
        createdAt: new Date()
      });

      // Guardar en la colección del tenant (para el frontend y el webhook)
      await db.collection('tenants').doc(tenantId).collection('qr_orders').doc(externalReference).set(orderDoc);

      return res.status(200).json({
        success: true,
        externalReference,
        total: calculatedTotal
      });

    } else if (action === 'cancel') {
      if (!externalReference || !refRegex.test(externalReference)) {
        return res.status(400).json({ error: 'Referencia externa inválida' });
      }

      const url = `https://api.mercadopago.com/instore/qr/seller/collectors/${mpUserId}/pos/${posExternalId}/orders`;

      await mpFetch(db, tenantId, url, {
        method: 'DELETE',
      }).catch(err => console.error('Error deleting MP order:', err));

      await db.collection('qr_order_index').doc(externalReference).delete().catch(() => {});
      await db.collection('tenants').doc(tenantId).collection('qr_orders').doc(externalReference).update({
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Acción no válida' });

  } catch (error) {
    console.error('QR Order Handler Error:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
}
