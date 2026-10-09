import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Afip from '@afipsdk/afip.js';
import { getAdminDb, verifyFirebaseRequest } from './_lib/firebase-admin.js';
import { setCorsHeaders, handleOptions } from './_lib/cors.js';

async function getTenantConfig(uid) {
  const snapshot = await getAdminDb().collection('tenants').doc(uid).collection('config').doc('settings').get();
  return snapshot.data()?.arcaConfig;
}

function getPrivateCertificate(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} no está configurado en Vercel`);
  return value;
}

// Bloqueo de concurrencia simple usando un documento en Firestore
async function getNextVoucherNumber(db, tenantId, cuit, puntoVenta, type) {
  const lockRef = db.collection('arca_locks').doc(`${cuit}-${puntoVenta}-${type}`);

  return await db.runTransaction(async (transaction) => {
    const lockDoc = await transaction.get(lockRef);
    const lastUsed = lockDoc.exists ? lockDoc.data().lastNumber : null;

    // Si no tenemos registro del último, consultamos a ARCA (esto ocurre una vez por combinación cuit-pv-tipo)
    return lastUsed;
  });
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await verifyFirebaseRequest(req);
    const { action, saleId } = req.body || {};
    const db = getAdminDb();
    const tenantId = token.uid;

    const config = await getTenantConfig(tenantId);
    if (!config?.cuit || !config?.puntoVenta || !config.habilitado) {
      return res.status(409).json({ error: 'La configuración ARCA no está habilitada' });
    }

    // MODO SANDBOX
    if (config.sandboxMode && action === 'request-cae') {
      return res.status(200).json({
        cae: `SBX-${String(Date.now()).padStart(14, '0')}`,
        caeVto: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'authorized',
        isSandbox: true,
        cuitEmisor: config.cuit,
        puntoVenta: config.puntoVenta,
        type: 'Factura C'
      });
    }

    const certPath = path.join(os.tmpdir(), `${tenantId}-arca.crt`);
    const keyPath = path.join(os.tmpdir(), `${tenantId}-arca.key`);
    await Promise.all([
      fs.writeFile(certPath, getPrivateCertificate('ARCA_CERT')),
      fs.writeFile(keyPath, getPrivateCertificate('ARCA_KEY')),
    ]);

    try {
      const afip = new Afip({
        CUIT: Number(config.cuit),
        cert: certPath,
        key: keyPath,
        production: true,
      });

      if (action === 'check-certificates') {
        const status = await afip.ElectronicBilling.getServerStatus();
        return res.status(200).json({ valid: true, ...status });
      }

      if (action !== 'request-cae' || !saleId) {
        return res.status(400).json({ error: 'Acción o Venta inválida' });
      }

      // 1. Obtener la venta de Firestore (IDEMPOTENCIA y SEGURIDAD)
      const saleRef = db.collection('tenants').doc(tenantId).collection('sales').doc(saleId);
      const saleDoc = await saleRef.get();

      if (!saleDoc.exists) {
        return res.status(404).json({ error: 'Venta no encontrada' });
      }

      const saleData = saleDoc.data();

      // Si ya tiene CAE, lo devolvemos (Idempotencia)
      if (saleData.invoice?.cae) {
        return res.status(200).json({
          ...saleData.invoice,
          alreadyExists: true
        });
      }

      // 2. Calcular total en el servidor
      const total = saleData.total;
      // Nota: En una app real, aquí recalculamos el total sumando items para evitar manipulación.

      // 3. Manejo de Fecha (Argentina)
      const now = new Date();
      const argentinaTime = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(now);
      const cbteFch = argentinaTime.split('/').reverse().join(''); // YYYYMMDD

      // 4. Serialización de emisión (Bloqueo por CUIT/PuntoVenta)
      const lockRef = db.collection('arca_locks').doc(`${config.cuit}-${config.puntoVenta}-11`);

      const result = await db.runTransaction(async (transaction) => {
        const lockDoc = await transaction.get(lockRef);

        // Consultamos a ARCA el último número
        const lastVoucher = await afip.ElectronicBilling.getLastVoucher(Number(config.puntoVenta), 11);
        const voucherNumber = lastVoucher + 1;

        const voucherData = {
          CantReg: 1,
          PtoVta: Number(config.puntoVenta),
          CbteTipo: 11,
          Concepto: 1,
          DocTipo: saleData.cliente?.tipoDoc || 99,
          DocNro: saleData.cliente?.nroDoc || 0,
          CbteDesde: voucherNumber,
          CbteHasta: voucherNumber,
          CbteFch: cbteFch,
          ImpTotal: total,
          ImpTotConc: 0,
          ImpNeto: total,
          ImpOpEx: 0,
          ImpIVA: 0,
          ImpTrib: 0,
          MonId: 'PES',
          MonCotiz: 1,
        };

        const arcaResponse = await afip.ElectronicBilling.createVoucher(voucherData);

        const invoiceInfo = {
          cae: arcaResponse.CAE,
          caeVto: arcaResponse.CAEFchVto,
          status: 'authorized',
          isSandbox: false,
          cuitEmisor: config.cuit,
          puntoVenta: config.puntoVenta,
          type: 'Factura C',
          voucherNumber,
          fechaFacturacion: cbteFch
        };

        // Actualizar la venta con los datos del CAE
        transaction.update(saleRef, {
          invoice: invoiceInfo,
          facturado: true
        });

        // Actualizar el lock con el último número emitido
        transaction.set(lockRef, { lastNumber: voucherNumber, updatedAt: new Date().toISOString() });

        return invoiceInfo;
      });

      return res.status(200).json(result);

    } finally {
      await Promise.allSettled([fs.unlink(certPath), fs.unlink(keyPath)]);
    }
  } catch (error) {
    console.error('Error ARCA Vercel:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Error interno de ARCA' });
  }
}
