import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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
  if (!value) throw new Error(`${name} no está configurado en el servidor`);
  return value;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const certPath = path.join(os.tmpdir(), `cert-${Date.now()}.crt`);
  const keyPath = path.join(os.tmpdir(), `key-${Date.now()}.key`);

  try {
    const token = await verifyFirebaseRequest(req);
    const tenantId = token.uid;
    const { action, saleId } = req.body || {};
    const db = getAdminDb();

    const config = await getTenantConfig(tenantId);
    if (!config?.habilitado || !config?.cuit || !config?.puntoVenta) {
      return res.status(400).json({ error: 'Configuración de ARCA incompleta' });
    }

    // Escribir certificados temporales
    await fsPromises.writeFile(certPath, getPrivateCertificate('ARCA_CERT'));
    await fsPromises.writeFile(keyPath, getPrivateCertificate('ARCA_PRIVATE_KEY'));

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

    const saleRef = db.collection('tenants').doc(tenantId).collection('sales').doc(saleId);
    const saleDoc = await saleRef.get();

    if (!saleDoc.exists) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const saleData = saleDoc.data();
    if (saleData.invoice?.cae) {
      return res.status(200).json({ ...saleData.invoice, alreadyExists: true });
    }

    const total = saleData.total;
    const now = new Date();
    const argentinaTime = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const cbteFch = argentinaTime.split('/').reverse().join('');

    const lockRef = db.collection('arca_locks').doc(`${config.cuit}-${config.puntoVenta}-11`);

    const result = await db.runTransaction(async (transaction) => {
      await transaction.get(lockRef);
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

      transaction.update(saleRef, { invoice: invoiceInfo, facturado: true });
      transaction.set(lockRef, { lastNumber: voucherNumber, updatedAt: new Date().toISOString() });

      return invoiceInfo;
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error('Error ARCA Handler:', error);
    return res.status(500).json({ error: error.message || 'Error interno de ARCA' });
  } finally {
    try {
      if (fs.existsSync(certPath)) await fsPromises.unlink(certPath);
      if (fs.existsSync(keyPath)) await fsPromises.unlink(keyPath);
    } catch { /* ignore cleanup errors */ }
  }
}
