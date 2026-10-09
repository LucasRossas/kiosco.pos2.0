import { useEffect, useRef } from 'react';
import { clearInventoryScan, clearScannerBarcode, listenInventoryScan, listenScannerSession } from '../services/firebase';
import { ScannerContext } from './scannerContext.js';
import { useContext } from 'react';

export function useScanner() {
  const context = useContext(ScannerContext);
  if (!context) throw new Error('useScanner debe usarse dentro de ScannerProvider');
  return context;
}

export function useScannerCode(mode, onCode) {
  const { activeSession } = useScanner();
  const callbackRef = useRef(onCode);

  useEffect(() => {
    callbackRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!activeSession || activeSession.mode !== mode) return undefined;
    return listenScannerSession(activeSession.tenantId, activeSession.scannerSessionId, (data, eventId) => {
      if (data?.barcode && data.mode === mode) {
        console.log('Código recibido en la PC:', data.barcode);
        try {
          callbackRef.current(data.barcode);
        } finally {
          clearScannerBarcode(activeSession.tenantId, activeSession.scannerSessionId, eventId).catch(() => {});
        }
      }
    });
  }, [activeSession, mode]);
}

export function useInventoryScan(onScan) {
  const { activeSession } = useScanner();
  const callbackRef = useRef(onScan);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!activeSession || activeSession.mode !== 'inventory') return undefined;
    return listenInventoryScan(activeSession.tenantId, activeSession.scannerSessionId, (scan, eventId) => {
      if (!scan.barcode) return;
      Promise.resolve(callbackRef.current(scan)).catch(() => {}).finally(() => {
        clearInventoryScan(activeSession.tenantId, activeSession.scannerSessionId, eventId).catch(() => {});
      });
    });
  }, [activeSession]);
}
