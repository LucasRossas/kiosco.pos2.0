import { getFirebaseAuth } from './firebase';
import { ARCA_ENABLED } from '../config/features';
import { API_BASE_URL } from './api';

/**
 * Servicio para interacción con ARCA (ex-AFIP) para Facturación Electrónica.
 * Maneja la obtención de CAE y validación de certificados.
 */

/**
 * Solicita un CAE (Código de Autorización Electrónico) para una venta.
 * @param {Object} sale - Objeto de la venta.
 * @param {Object} config - Configuración de ARCA (cuit, puntoVenta, sandboxMode, etc).
 * @returns {Promise<Object>} Resultado con el CAE y vencimiento.
 */
export async function solicitarCAE(sale, config) {
  if (!ARCA_ENABLED) {
    throw new Error('La facturación electrónica (ARCA) está temporalmente deshabilitada.');
  }

  if (!config?.habilitado) {
    throw new Error('La facturación electrónica no está habilitada en la configuración.');
  }

  if (!config.cuit || !config.puntoVenta) {
    throw new Error('Configuración de CUIT o Punto de Venta incompleta.');
  }

  // MODO SANDBOX / PRUEBAS
  if (config.sandboxMode) {
    // Simulamos una demora de red
    await new Promise(resolve => setTimeout(resolve, 1500));

    return {
      cae: `SBX-${Math.floor(Math.random() * 10000000000000).toString().padStart(14, '0')}`,
      caeVto: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'authorized',
      isSandbox: true,
      cuitEmisor: config.cuit,
      puntoVenta: config.puntoVenta,
      type: 'Factura C'
    };
  }

  try {
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    const response = await fetch(`${API_BASE_URL}/api/arca`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'request-cae', saleId: sale.id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error de ARCA');
    return result;
  } catch (error) {
    console.error("Error al solicitar CAE:", error);
    throw new Error(error.message || 'Error de comunicación con ARCA.', { cause: error });
  }
}

/**
 * Valida si los certificados configurados son vigentes.
 */
export async function validarCertificados() {
  try {
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    const response = await fetch(`${API_BASE_URL}/api/arca`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'check-certificates' })
    });
    return await response.json();
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Genera el enlace para el código QR oficial de AFIP/ARCA.
 * @param {Object} sale - Datos de la venta con información de factura.
 * @param {Object} config - Configuración de ARCA.
 * @returns {string} URL del QR.
 */
export function getAfipQrUrl(sale, config) {
  if (!sale || !sale.cae) return null;

  // Datos según especificación ARCA para el QR
  const data = {
    ver: 1,
    fecha: sale.fechaFacturacion || new Date(sale.timestamp?.seconds * 1000).toISOString().split('T')[0],
    cuit: Number(config.cuit),
    ptoVta: Number(sale.puntoVenta || config.puntoVenta),
    tipoCmp: Number(sale.tipoCmp || 11), // 11: Factura C
    nroCmp: Number(sale.nroCmp),
    importe: Number(sale.total),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: Number(sale.cliente?.tipoDoc || 99), // 99: Sin identificar/Consumidor Final
    nroDocRec: Number(sale.cliente?.nroDoc || 0),
    tipoCodAut: "E", // "E" para CAE
    codAut: Number(sale.cae)
  };

  const encoded = btoa(JSON.stringify(data));
  return `https://www.afip.gob.ar/fe/qr/?p=${encoded}`;
}
