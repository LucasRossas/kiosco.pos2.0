import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';
import { mpFetch } from './_lib/mp-token.js';
import crypto from 'node:crypto';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const db = getAdminDb();

    // 1. Obtener credenciales y configuración del comercio
    const privateRef = db.collection('private_integrations').doc(tenantId);
    const privateSnap = await privateRef.get();
    const mpData = privateSnap.data()?.mercadoPago;

    if (!mpData?.accessToken || !mpData?.qrConfig?.externalPosId) {
      return res.status(400).json({ error: 'Mercado Pago no configurado correctamente.' });
    }

    const externalPosId = mpData.qrConfig.externalPosId;
    const userId = mpData.userId;

    // --- MANEJO DE CANCELACIÓN (DELETE) ---
    if (req.method === 'DELETE') {
      const url = `https://api.mercadopago.com/instore/qr/seller/collectors/${userId}/pos/${externalPosId}/orders`;
      const mpRes = await mpFetch(db, tenantId, url, { method: 'DELETE' });

      if (req.body?.external_reference) {
        await db.collection('tenants').doc(tenantId).collection('qr_orders').doc(req.body.external_reference).update({
          status: 'cancelled',
          updatedAt: new Date().toISOString()
        }).catch(() => {});
      }

      return res.status(200).json({ success: true, message: 'Orden removida del QR' });
    }

    // --- MANEJO DE CREACIÓN (POST) ---
    if (req.method === 'POST') {
      const { amount, description, external_reference, items, saleMetadata } = req.body;

      if (!amount || !external_reference) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
      }

      const url = 'https://api.mercadopago.com/v1/orders';
      const orderPayload = {
        type: "qr",
        external_reference,
        total_amount: Number(amount),
        description: description || `Venta ${tenantId}`,
        items: items || [{
          title: "Venta POS",
          unit_price: Number(amount),
          quantity: 1,
          unit_measure: "unit",
          total_amount: Number(amount)
        }],
        config: {
          qr: {
            external_pos_id: externalPosId,
            mode: "static"
          }
        },
        notification_url: `${process.env.APP_ORIGIN_API}/api/mercadopago-qr-webhook?tenantId=${tenantId}`
      };

      const mpRes = await mpFetch(db, tenantId, url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(orderPayload)
      });

      const mpOrder = await mpRes.json();
      if (!mpRes.ok) throw new Error(mpOrder.message || 'Error en Mercado Pago');

      // Guardar en Firestore para seguimiento
      await db.collection('tenants').doc(tenantId).collection('qr_orders').doc(external_reference).set({
        order_id: mpOrder.id,
        status: 'created',
        amount: Number(amount),
        external_reference,
        saleId: external_reference.split('_')[1],
        createdAt: new Date().toISOString(),
        saleMetadata
      });

      // Índice para el Webhook (por external_reference y por ID de orden de MP)
      const indexData = {
        tenantId,
        external_reference,
        createdAt: new Date()
      };

      await db.collection('qr_order_index').doc(external_reference).set(indexData);

      if (mpOrder.id) {
        await db.collection('qr_order_index').doc(String(mpOrder.id)).set(indexData);
      }

      return res.status(200).json({ order_id: mpOrder.id, status: 'created', external_reference });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('QR Order Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
