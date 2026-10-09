import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createScannerSession } from '../services/firebase';
import { ScannerContext } from './scannerContext.js';

class QrModalErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="modal-content scanner-link-modal"><h3>No se pudo mostrar el QR</h3><p className="scanner-error">La sesión se creó, pero el código no pudo renderizarse. Cerrá y volvé a intentar.</p><button type="button" className="btn-secondary" onClick={() => this.setState({ hasError: false })}>Cerrar</button></div>;
    }
    return this.props.children;
  }
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getScannerBaseUrl() {
  const configuredUrl = import.meta.env.VITE_SCANNER_BASE_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  const { hostname, origin } = window.location;
  const firebaseProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (firebaseProjectId && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || window.location.protocol !== 'https:')) {
    return `https://${firebaseProjectId}.web.app`;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'http://192.168.1.54:5173';
  }
  return origin;
}

export function ScannerProvider({ tenantId, children }) {
  const [activeSession, setActiveSession] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const openScanner = async (mode) => {
    if (!tenantId) {
      setError('No hay un comercio activo para vincular el lector.');
      return;
    }
    setIsCreating(true);
    setError('');
    setActiveSession(null);
    try {
      const scannerSessionId = createSessionId();
      await createScannerSession(tenantId, scannerSessionId, mode);
      const url = `${getScannerBaseUrl()}/scan?sid=${encodeURIComponent(scannerSessionId)}&tid=${encodeURIComponent(tenantId)}&mode=${encodeURIComponent(mode)}`;
      if (!url || !scannerSessionId || !tenantId) throw new Error('No se pudo preparar el enlace del lector.');
      setActiveSession({ scannerSessionId, tenantId, mode, url });
    } catch (sessionError) {
      console.error('No se pudo crear la sesión QR:', sessionError);
      setError(sessionError?.message || 'No se pudo crear la sesión del lector QR. Verificá la conexión y los permisos de Firebase.');
    } finally {
      setIsCreating(false);
    }
  };

  const closeScanner = () => {
    setActiveSession(null);
    setError('');
  };

  const hasQrSession = Boolean(activeSession?.tenantId && activeSession?.scannerSessionId && activeSession?.url);

  return (
    <ScannerContext.Provider value={{ activeSession, isCreating, error, openScanner, closeScanner }}>
      {children}
      {(isCreating || activeSession || error) && (
        <div className="modal-overlay">
          <QrModalErrorBoundary>
          <div className="modal-content scanner-link-modal">
            {isCreating && !activeSession && <p>Generando sesión...</p>}
            {error && <p className="scanner-error" role="alert">{error}</p>}
            {activeSession && <>
            <div className="modal-heading">
              <div><h3>Vincular lector QR</h3><p className="off-hint">Modo {activeSession.mode === 'pos' ? 'Caja' : 'Inventario'}</p></div>
              <button type="button" className="btn-icon" onClick={closeScanner} aria-label="Cerrar">×</button>
            </div>
            <p className="scanner-link-instructions">Escaneá este QR con el celular para vincularlo a esta pantalla.</p>
            {!hasQrSession ? <p className="off-hint">Generando sesión...</p> : <><div className="scanner-link-qr"><QRCodeSVG value={activeSession.url} size={280} level="M" includeMargin /></div><code className="scanner-link-url">{activeSession.url}</code></>}
            <button type="button" className="btn-secondary" onClick={closeScanner}>Cerrar</button>
            </>}
            {error && !activeSession && <button type="button" className="btn-secondary" onClick={() => setError('')}>Cerrar</button>}
          </div>
          </QrModalErrorBoundary>
        </div>
      )}
    </ScannerContext.Provider>
  );
}

