import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { X, RefreshCw, SwitchCamera } from "lucide-react";

const REGION_ID = "barcode-scanner-region";
const PREFERRED_CAMERA_KEY = "lector.preferredCameraId";

const FRONT_RE = /front|user|face|frontal|selfie|facing\s*front/i;
const REAR_RE =
  /back|rear|environment|trasera|posterior|world|facing\s*back|facing\s*environment/i;

const SCAN_CONFIG = {
  fps: 10,
  qrbox: (viewWidth, viewHeight) => ({
    width: Math.max(180, Math.min(Math.floor(viewWidth * 0.86), 320)),
    height: Math.max(100, Math.min(Math.floor(viewHeight * 0.32), 150)),
  }),
  disableFlip: true,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFrontLabel(label = "") {
  return FRONT_RE.test(label);
}

function isRearLabel(label = "") {
  return REAR_RE.test(label) && !FRONT_RE.test(label);
}

function rankCameras(cameras) {
  if (cameras.length <= 1) return [...cameras];
  const unlabeledPreferLast = !cameras.some(
    (cam) => isFrontLabel(cam.label) || isRearLabel(cam.label),
  );

  return cameras
    .map((cam, index) => {
      let score = 0;
      if (isFrontLabel(cam.label)) score = -1000 + index;
      else if (isRearLabel(cam.label)) score = 1000 - index;
      else if (unlabeledPreferLast) {
        // Heurística para Android (Chrome): si no hay etiquetas, el índice 1
        // suele ser la cámara trasera principal. El 0 suele ser la frontal.
        if (index === 1) score = 100;
        else if (index === 0) score = 50;
        else score = index;
      }
      return { cam, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.cam);
}

function pickRearCamera(cameras) {
  if (!cameras.length) return null;
  return rankCameras(cameras)[0] ?? null;
}

function classifyCamera(settings, cameras) {
  if (settings?.facingMode === "user") return "front";
  if (settings?.facingMode === "environment") return "rear";

  const current = settings?.deviceId
    ? cameras.find((cam) => cam.id === settings.deviceId)
    : undefined;

  if (current) {
    if (isFrontLabel(current.label)) return "front";
    if (isRearLabel(current.label)) return "rear";
  }

  return "unknown";
}

async function listVideoCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device) => ({
      id: device.deviceId,
      label: device.label || "",
    }));
}

function readSavedCameraId() {
  try {
    return localStorage.getItem(PREFERRED_CAMERA_KEY);
  } catch {
    return null;
  }
}

function saveCameraId(id) {
  if (!id) return;
  try {
    localStorage.setItem(PREFERRED_CAMERA_KEY, id);
  } catch {
    // ignore
  }
}

function cameraErrorMessage(err) {
  const name = err?.name || "";
  const message = err?.message || "";

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "La cámara requiere una conexión segura (HTTPS).";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permiso de cámara denegado. Habilitá la cámara en Chrome.";
  }
  if (name === "OverconstrainedError") {
    return "No se encontró una cámara trasera en este dispositivo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No hay ninguna cámara disponible.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "La cámara está ocupada. Cerrá otras apps que la usen y reintentá.";
  }
  if (name === "SecurityError") {
    return "El navegador bloqueó la cámara por seguridad.";
  }
  if (message) return message;
  return "No se pudo abrir la cámara trasera.";
}

async function safeStop(scanner) {
  if (!scanner) return;
  try {
    const state = scanner.getState?.();
    if (scanner.isScanning || state === 2 || state === 3) {
      await scanner.stop();
    }
  } catch {
    // already stopped
  }
}

function unlockVideo(regionId) {
  const video = document.querySelector(`#${regionId} video`);
  if (!video) return;
  video.setAttribute("playsinline", "true");
  video.setAttribute("muted", "true");
  video.muted = true;
  video.playsInline = true;
}

export default function BarcodeScanner({ onScan, onClose, isContinuous = false }) {
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Preparando cámara trasera...");
  const [cameraKind, setCameraKind] = useState("unknown");
  const [engineKey, setEngineKey] = useState(0);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const scannerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const handledRef = useRef(false);
  const camerasRef = useRef([]);
  const currentIdRef = useRef(null);
  const forceCameraIdRef = useRef(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let cancelled = false;
    handledRef.current = false;

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Este navegador no permite usar la cámara. Probá Chrome y HTTPS.",
        );
        setStatus("Cámara no disponible");
        return;
      }

      setError(null);
      setStatus("Buscando cámara trasera...");
      setCameraKind("unknown");

      const scanner = new Html5Qrcode(REGION_ID, {
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      });

      scannerRef.current = scanner;

      const onSuccess = (decodedText) => {
        if (cancelled || (handledRef.current && !isContinuous)) return;

        if (!isContinuous) {
          handledRef.current = true;
        }

        setStatus("Código leído");
        // Delegamos el stop al cleanup del useEffect para evitar condiciones de carrera en el Main Thread
        setTimeout(() => {
          if (!cancelled) onScanRef.current(decodedText.trim());
        }, 150);
      };

      const tryStart = async (target, allowFront) => {
        if (cancelled) return "cancelled";
        await safeStop(scanner);
        if (cancelled) return "cancelled";

        try {
          // NO pases videoConstraints: pisa el deviceId y abre la frontal.
          await scanner.start(target, SCAN_CONFIG, onSuccess, () => {});
        } catch (err) {
          await safeStop(scanner);
          throw err;
        }

        if (cancelled) {
          await safeStop(scanner);
          return "cancelled";
        }

        unlockVideo(REGION_ID);

        let cameras = camerasRef.current;
        try {
          cameras = rankCameras(await listVideoCameras());
          camerasRef.current = cameras;
          setHasMultipleCameras(cameras.length > 1);
        } catch {
          // keep previous list
        }

        let settings = null;
        try {
          settings = scanner.getRunningTrackSettings();
        } catch {
          // La cámara puede no exponer ajustes antes de iniciar el track.
        }

        const kind = classifyCamera(settings, cameras);
        currentIdRef.current =
          settings?.deviceId ?? (typeof target === "string" ? target : null);

        if (kind === "front" && !allowFront) {
          setStatus("Cámara frontal detectada, cambiando a la trasera...");
          await safeStop(scanner);
          await sleep(280);
          return "front";
        }

        saveCameraId(currentIdRef.current);
        setCameraKind(kind);
        setStatus("Apuntá al código de barras");
        setError(null);
        return "ok";
      };

      const tryCatch = async (target, allowFront) => {
        try {
          return await tryStart(target, allowFront);
        } catch {
          await safeStop(scanner);
          return "fail";
        }
      };

      try {
        const forcedId = forceCameraIdRef.current;
        if (forcedId) {
          const result = await tryCatch(forcedId, true);
          if (result === "ok" || result === "cancelled") return;
          throw new Error("No se pudo abrir esa cámara.");
        }

        const savedId = readSavedCameraId();
        if (savedId) {
          setStatus("Encendiendo la última cámara trasera...");
          const result = await tryCatch(savedId, false);
          if (result === "ok" || result === "cancelled") return;
        }

        setStatus("Solicitando cámara trasera...");
        const exactResult = await tryCatch(
          { facingMode: { exact: "environment" } },
          false,
        );
        if (exactResult === "ok" || exactResult === "cancelled") return;

        let cameras = camerasRef.current;
        if (cameras.length === 0) {
          cameras = rankCameras(await listVideoCameras());
          camerasRef.current = cameras;
          setHasMultipleCameras(cameras.length > 1);
        }

        if (cameras.length === 0 || cameras.every((cam) => !cam.label)) {
          setStatus("Confirmando permisos de cámara...");
          const warmup = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" } },
          });
          warmup.getTracks().forEach((track) => track.stop());
          await sleep(350);
          if (cancelled) return;
          cameras = rankCameras(await listVideoCameras());
          camerasRef.current = cameras;
          setHasMultipleCameras(cameras.length > 1);
        }

        const preferred = pickRearCamera(cameras);
        const ordered = rankCameras(cameras);
        const tried = new Set();
        if (savedId) tried.add(savedId);

        const candidates = [
          ...(preferred ? [preferred] : []),
          ...ordered.filter((cam) => !isFrontLabel(cam.label)),
        ];

        for (const cam of candidates) {
          if (tried.has(cam.id)) continue;
          tried.add(cam.id);
          setStatus("Encendiendo cámara trasera...");
          const result = await tryCatch(cam.id, false);
          if (result === "ok" || result === "cancelled") return;
        }

        const idealResult = await tryCatch(
          { facingMode: { ideal: "environment" } },
          true,
        );
        if (idealResult === "ok" || idealResult === "cancelled") return;

        for (const cam of ordered) {
          if (tried.has(cam.id)) continue;
          tried.add(cam.id);
          const result = await tryCatch(cam.id, true);
          if (result === "ok" || result === "cancelled") return;
        }

        throw new Error("No se pudo abrir la cámara trasera.");
      } catch (err) {
        if (cancelled) return;
        console.error("ERROR CÁMARA", err);
        setError(cameraErrorMessage(err));
        setStatus("Cámara trasera no disponible");
      }
    };

    const startTimer = setTimeout(() => {
      startScanner();
    }, 160);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (!scanner) return;
      safeStop(scanner).then(() => {
        try {
          scanner.clear();
        } catch {
          // ignore
        }
      });
    };
  }, [engineKey, isContinuous]);

  const handleRetry = () => {
    forceCameraIdRef.current = null;
    setError(null);
    setEngineKey((key) => key + 1);
  };

  const handleSwitchCamera = () => {
    const cameras = camerasRef.current;
    if (cameras.length === 0) {
      forceCameraIdRef.current = null;
      setEngineKey((key) => key + 1);
      return;
    }
    const currentId = currentIdRef.current;
    const index = Math.max(
      0,
      cameras.findIndex((cam) => cam.id === currentId),
    );
    const next = cameras[(index + 1) % cameras.length];
    if (!next) return;
    forceCameraIdRef.current = next.id;
    setError(null);
    setEngineKey((key) => key + 1);
  };

  const kindLabel =
    cameraKind === "rear"
      ? "Cámara trasera"
      : cameraKind === "front"
        ? "Cámara frontal"
        : "Cámara lista";

  const containerStyle = isContinuous
    ? { width: "100%", height: "100%", background: "#000" }
    : {};

  const content = (
    <>
      <div className="scanner-viewport" style={isContinuous ? { flex: 1, margin: 0, borderRadius: 0 } : {}}>
        <div
          id={REGION_ID}
          style={{
            width: "100%",
            minHeight: isContinuous ? "100%" : "250px",
            background: "#000",
          }}
        />
        <div className="scanner-frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="scanner-frame-label">
          Alineá el código dentro del recuadro
        </div>
      </div>

      <p
        className="scanner-status"
        style={{
          marginTop: 12,
          fontWeight: "bold",
          textAlign: "center",
          color: isContinuous ? "white" : "inherit"
        }}
      >
        {status}
      </p>

      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: 12,
            fontWeight: 600,
            color: cameraKind === "front" ? "#dc2626" : (isContinuous ? "#9ca3af" : "#6b7280"),
          }}
        >
          {kindLabel}
        </span>
      </div>

      {(hasMultipleCameras || cameraKind === "front") && (
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleSwitchCamera}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              background: isContinuous ? "rgba(255,255,255,0.1)" : undefined,
              color: isContinuous ? "white" : undefined,
              border: isContinuous ? "1px solid rgba(255,255,255,0.2)" : undefined
            }}
          >
            <SwitchCamera size={16} />
            Cambiar cámara
          </button>
        </div>
      )}

      {error && (
        <div style={{ textAlign: "center", margin: "16px 0" }}>
          <p
            className="scanner-error"
            style={{ color: "#dc2626", marginBottom: 12 }}
          >
            {error}
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleRetry}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
            }}
          >
            <RefreshCw size={16} />
            Reintentar cámara trasera
          </button>
        </div>
      )}

      {!isContinuous && (
        <form
          className="scanner-manual"
          onSubmit={(event) => {
            event.preventDefault();
            const code =
              event.currentTarget.elements.manualCode.value.trim();
            if (code) onScanRef.current(code);
          }}
          style={{ marginTop: 16 }}
        >
          <input
            name="manualCode"
            inputMode="numeric"
            placeholder="O ingresá código manual"
          />
          <button type="submit" className="btn-primary">
            Usar
          </button>
        </form>
      )}
    </>
  );

  if (isContinuous) {
    return (
      <div style={containerStyle} className="continuous-scanner">
        {content}
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content scanner-modal">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3>Escanear producto</h3>
          <button onClick={onClose} className="btn-icon" title="Cerrar">
            <X size={24} />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
