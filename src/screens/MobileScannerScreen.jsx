import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Loader2,
  Camera,
  XCircle,
  Package,
  Save,
  ArrowLeft,
  CheckCircle2,
  Smartphone,
  Tag
} from 'lucide-react';
import { CATEGORIES_CONFIG } from '../config/categories';
import { toast } from 'sonner';
import {
  findTenantProductByBarcode,
  isFirebaseConfigured,
  loadGlobalProduct,
  publishInventoryScan,
  publishScannerBarcode
} from '../services/firebase';
import { lookupProductCascade } from '../services/openFoodFacts';
import BarcodeScanner from '../components/BarcodeScanner';

/**
 * Diccionario de imágenes para cortes de carne
 */
const MEAT_IMAGES = {
  "molida": "/Imagenes de carnes/MOLIDA.png",
  "picada": "/Imagenes de carnes/MOLIDA.png",
  "roast beef": "/Imagenes de carnes/ROAST BEEF.png",
  "vacio": "/Imagenes de carnes/VACIO.png",
  "asado": "/Imagenes de carnes/COSTILLA.png",
  "costilla": "/Imagenes de carnes/COSTILLA.png",
  "matambre": "/Imagenes de carnes/MATAMBRE.png",
  "peceto": "/Imagenes de carnes/PECETO.png",
  "nalga": "/Imagenes de carnes/NALGA.png",
  "bola de lomo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "cuadril": "/Imagenes de carnes/CUADRIL.png",
  "colita de cuadril": "/Imagenes de carnes/COLITA DE CUADRIL.png",
  "lomo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "bife de chorizo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "ojo de bife": "/Imagenes de carnes/ROAST BEEF.png",
  "entraña": "/Imagenes de carnes/ENTRAÑA.png",
  "falda": "/Imagenes de carnes/COSTILLA.png",
  "osobuco": "/Imagenes de carnes/OSOBUCO.png",
  "paleta": "/Imagenes de carnes/PALETA.png",
  "tapa de asado": "/Imagenes de carnes/TAPA DE ASADO.png",
  "tapa de nalga": "/Imagenes de carnes/TAPA DE NALGA.png",
  "palomita": "/Imagenes de carnes/PALOMITA.png",
  "marucha": "/Imagenes de carnes/MARUCHA.png",
  "cuadrada": "/Imagenes de carnes/CUADRADA.png",
  "espinazo": "/Imagenes de carnes/ESPINAZO.png",
};

/**
 * Diccionario de iconos para verdulería (Emojis)
 */
const VERDULERIA_DICTIONARY = [
  { name: "papa", icon: "🥔" },
  { name: "cebolla", icon: "🧅" },
  { name: "zanahoria", icon: "🥕" },
  { name: "tomate", icon: "🍅" },
  { name: "lechuga", icon: "🥬" },
  { name: "ajo", icon: "🧄" },
  { name: "pimiento", icon: "🫑" },
  { name: "morron", icon: "🫑" },
  { name: "zapallo", icon: "🎃" },
  { name: "batata", icon: "🍠" },
  { name: "berenjena", icon: "🍆" },
  { name: "choclo", icon: "🌽" },
  { name: "pepino", icon: "🥒" },
  { name: "brocoli", icon: "🥦" },
  { name: "limon", icon: "🍋" },
  { name: "manzana", icon: "🍎" },
  { name: "banana", icon: "🍌" },
  { name: "naranja", icon: "🍊" },
  { name: "pera", icon: "🍐" },
  { name: "uva", icon: "🍇" },
  { name: "frutilla", icon: "🍓" },
  { name: "palta", icon: "🥑" },
];

const normalizeText = (text) => {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

/**
 * MobileScannerScreen - Versión Senior Refactorizada
 * Optimizado para estabilidad de hardware (ciclo de vida de cámara)
 * y concurrencia multi-terminal sin dependencia de Cloud Functions (No Blaze).
 */

const playFeedback = () => {
  try {
    // Haptic Feedback (Enterprise UX)
    if (navigator.vibrate) {
      navigator.vibrate([50, 50]);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();

    // En móviles es necesario reanudar el contexto si está suspendido
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);

    // Limpieza del contexto para liberar memoria de hardware
    setTimeout(() => audioCtx.close(), 200);
  } catch (e) {
    console.warn('Feedback no disponible', e);
  }
};

export default function MobileScannerScreen() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sid') || '';
  const tenantId = params.get('tid') || '';
  const mode = params.get('mode') === 'inventory' ? 'inventory' : 'pos';
  const hasValidConnection = Boolean(sessionId && tenantId && isFirebaseConfigured);

  // Estados de la Aplicación
  const [step, setStep] = useState('SCAN'); // 'SCAN' | 'EDIT'
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionFinished, setIsSessionFinished] = useState(false);

  // Estados del Producto
  const [barcode, setBarcode] = useState('');
  const [productImage, setProductImage] = useState('');
  const [form, setForm] = useState({ name: '', price: '', stock: '', category: 'General', isByWeight: false });
  const [suggestedImage, setSuggestedImage] = useState(null);

  // Feedback visual para POS
  const [posStatus, setPosStatus] = useState(null);

  // Cooldown de escaneo (Debouncing)
  const lastScanTime = useRef(0);
  const lastScanBarcode = useRef('');

  // 1. Efecto de Sincronización Offline (Queue manager)
  useEffect(() => {
    const processQueue = async () => {
      if (!navigator.onLine || !hasValidConnection) return;

      const queue = JSON.parse(localStorage.getItem('scanner_queue') || '[]');
      if (queue.length === 0) return;

      const newQueue = [];
      for (const item of queue) {
        try {
          if (item.mode === 'pos') {
            await publishScannerBarcode(tenantId, sessionId, item.barcode);
          } else if (item.mode === 'inventory') {
            await publishInventoryScan(tenantId, sessionId, item.data);
          }
        } catch {
          newQueue.push(item);
        }
      }

      localStorage.setItem('scanner_queue', JSON.stringify(newQueue));
      if (newQueue.length === 0) {
        toast.success('Sincronización offline completada');
      }
    };

    window.addEventListener('online', processQueue);
    return () => window.removeEventListener('online', processQueue);
  }, [tenantId, sessionId, hasValidConnection]);

  // 2. Validación de Configuración
  if (!hasValidConnection) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 max-w-sm w-full">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="text-red-500" size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 mb-2">Sesión Inválida</h3>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">
            El enlace de vinculación ha expirado o es incorrecto. Escaneá el QR desde tu terminal principal.
          </p>
        </div>
      </div>
    );
  }

  // 2. Pantalla de Finalización
  if (isSessionFinished) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 max-w-sm w-full animate-in zoom-in duration-300">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-500" size={40} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-3">¡Buen trabajo!</h2>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">
            La sesión se ha cerrado correctamente. Podés cerrar esta pestaña.
          </p>
          <button
            className="w-full bg-slate-900 text-white font-bold py-5 rounded-2xl shadow-lg active:scale-95 transition-all uppercase tracking-widest text-xs"
            onClick={() => window.close()}
          >
            Cerrar Navegador
          </button>
        </div>
      </div>
    );
  }

  /**
   * Manejador de Escaneo Inteligente
   */
  const handleScan = async (code) => {
    if (!code || isLoading) return;

    // Cooldown check (Evita lecturas dobles en 1000ms)
    const now = Date.now();
    if (code === lastScanBarcode.current && (now - lastScanTime.current) < 1000) {
      return;
    }
    lastScanTime.current = now;
    lastScanBarcode.current = code;

    playFeedback();

    if (mode === 'pos') {
      setPosStatus(`Enviado: ${code}`);
      try {
        await publishScannerBarcode(tenantId, sessionId, code);
        toast.success('Producto añadido a la venta');
      } catch {
        // Fallback Offline Queue
        const queue = JSON.parse(localStorage.getItem('scanner_queue') || '[]');
        queue.push({ mode: 'pos', barcode: code, timestamp: new Date().toISOString() });
        localStorage.setItem('scanner_queue', JSON.stringify(queue));
        toast.info('Guardado localmente. Se sincronizará al recuperar señal.');
      }
      setTimeout(() => setPosStatus(null), 1500);
      return;
    }

    // MODO INVENTARIO: Cambio de estado SCAN -> EDIT
    setIsLoading(true);
    try {
      // Búsqueda en cascada (Local -> Global)
      const tenantProduct = await findTenantProductByBarcode(tenantId, code);
      const externalProduct = tenantProduct ? null : await lookupProductCascade(code, loadGlobalProduct);

      const found = tenantProduct || (externalProduct?.found ? {
        name: externalProduct.name || '',
        imageUrl: externalProduct.image || '',
        price: externalProduct.suggestedPrice || '',
      } : null);

      setBarcode(code);
      setProductImage(found?.imageUrl || '');
      setForm({
        name: found?.name || '',
        price: found?.price || '',
        stock: '',
        category: found?.category || 'General',
        isByWeight: found?.isByWeight || false
      });

      // DESMONTA LA CÁMARA (Previene cuelgues de hardware)
      setStep('EDIT');
    } catch {
      toast.error('Error al identificar el producto');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Guardado Atómico (Directo a Firestore, No Blaze)
   */
  const saveProduct = async (e) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    try {
      const isByWeight = form.isByWeight;
      const stockVal = isByWeight ? null : (form.stock === '' ? 0 : Number(String(form.stock).replace(',', '.')));
      const priceVal = Number(String(form.price).replace(/[^0-9.-]+/g, '').replace(',', '.'));

      if (!form.name.trim() || isNaN(priceVal) || priceVal < 0) {
        throw new Error('Datos inválidos. Revisá nombre y precio.');
      }

      const scanData = {
        barcode,
        name: form.name.trim(),
        price: priceVal,
        stock: stockVal,
        category: form.category,
        isByWeight: isByWeight,
        imageUrl: productImage,
      };

      try {
        await publishInventoryScan(tenantId, sessionId, scanData);
        toast.success('Inventario actualizado');
      } catch {
        // Fallback Offline Queue
        const queue = JSON.parse(localStorage.getItem('scanner_queue') || '[]');
        queue.push({ mode: 'inventory', data: scanData, timestamp: new Date().toISOString() });
        localStorage.setItem('scanner_queue', JSON.stringify(queue));
        toast.info('Guardado localmente. Se sincronizará al recuperar señal.');
      }

      resetToScan();
    } catch (error) {
      toast.error(error.message || 'Error al guardar');
    } finally {
      setIsLoading(false);
    }
  };

  const resetToScan = () => {
    setBarcode('');
    setProductImage('');
    setForm({ name: '', price: '', stock: '', category: 'General', isByWeight: false });
    setSuggestedImage(null);
    setStep('SCAN');
  };

  const handleNameChange = (e) => {
    const val = e.target.value;
    setForm({ ...form, name: val });

    const cleanVal = normalizeText(val);

    // Sugerencia dinámica (Search as you type) - Mínimo 3 caracteres
    if (cleanVal.length >= 3) {
      // 1. Buscar en Carnes
      const meatMatch = Object.entries(MEAT_IMAGES).find(([key]) => {
        const normalizedKey = normalizeText(key);
        return normalizedKey.startsWith(cleanVal) || cleanVal.includes(normalizedKey);
      });

      if (meatMatch) {
        setSuggestedImage({
          key: meatMatch[0],
          value: meatMatch[1],
          type: 'image',
          category: 'Carnicería'
        });
        return;
      }

      // 2. Buscar en Verduras
      const vegMatch = VERDULERIA_DICTIONARY.find(item => {
        const normalizedKey = normalizeText(item.name);
        return normalizedKey.startsWith(cleanVal) || cleanVal.includes(normalizedKey);
      });

      if (vegMatch) {
        setSuggestedImage({
          key: vegMatch.name,
          value: vegMatch.icon,
          type: 'icon',
          category: 'Verdulería'
        });
        return;
      }

      setSuggestedImage(null);
    } else {
      setSuggestedImage(null);
      // Limpieza si borra el texto y la imagen/emoji era sugerido
      const isMeatPath = productImage.startsWith('/Imagenes de carnes/');
      const isEmoji = productImage.length <= 4 && productImage !== '';
      if (isMeatPath || isEmoji) {
        setProductImage('');
      }
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto shadow-2xl border-x border-slate-200 font-sans select-none overflow-x-hidden relative">

      {/* HEADER TÁCTIL */}
      <header className="px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-[60]">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200">
            <Smartphone size={20} />
          </div>
          <div>
            <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest leading-none mb-1">
              Terminal Móvil
            </p>
            <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">
              {mode === 'pos' ? 'Lector POS' : 'Inventario'}
            </h1>
          </div>
        </div>
        <button
          className="p-3 bg-slate-50 text-slate-400 rounded-2xl active:bg-red-50 active:text-red-500 transition-all"
          onClick={() => setIsSessionFinished(true)}
        >
          <XCircle size={22} />
        </button>
      </header>

      {/* BODY DINÁMICO */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 animate-pulse">
            <div className="relative mb-6">
              <div className="w-20 h-20 border-[6px] border-slate-100 border-t-blue-600 rounded-full animate-spin" />
              <Package className="absolute inset-0 m-auto text-blue-200" size={32} />
            </div>
            <p className="text-lg font-black text-slate-800">Sincronizando...</p>
          </div>
        ) : step === 'SCAN' ? (
          /* MODO ESCANEO */
          <div className="flex-1 flex flex-col animate-in fade-in duration-500">
            <div className="text-center mb-6">
              <div className="inline-flex p-4 bg-blue-50 text-blue-600 rounded-[2rem] mb-4 shadow-sm border border-blue-100">
                <Camera size={32} />
              </div>
              <p className="text-slate-600 font-bold px-8 leading-tight">
                {posStatus ? (
                   <span className="text-emerald-600 flex items-center justify-center gap-2">
                     <CheckCircle2 size={16} /> {posStatus}
                   </span>
                ) : 'Apuntá al código de barras para escanear.'}
              </p>
            </div>

            {/* CÁMARA */}
            <div className="flex-1 min-h-[400px] rounded-[3rem] overflow-hidden bg-black border-[10px] border-white shadow-2xl relative ring-1 ring-slate-200">
              <BarcodeScanner
                onScan={handleScan}
                onClose={() => setIsSessionFinished(true)}
                isContinuous={mode === 'pos'}
              />
              {/* Overlay de Guía */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-64 h-40 border-2 border-white/20 rounded-3xl relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500/50 rounded-tl-2xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500/50 rounded-tr-2xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500/50 rounded-bl-2xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500/50 rounded-br-2xl" />
                </div>
              </div>

              {/* Indicador de Modo */}
              <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${mode === 'inventory' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">
                    Modo {mode === 'inventory' ? 'Inventario' : 'Venta POS'}
                  </span>
                </div>
              </div>
            </div>

            <button
              className="mt-8 text-slate-400 font-bold text-xs uppercase tracking-widest active:text-slate-600 py-4"
              onClick={() => setIsSessionFinished(true)}
            >
              Terminar Jornada
            </button>
          </div>
        ) : (
          /* MODO EDICIÓN */
          <form onSubmit={saveProduct} className="flex-1 flex flex-col animate-in slide-in-from-bottom-10 duration-500">
            <div className="flex-1 space-y-8">

              {/* Card de Identificación */}
              <div className="bg-white p-6 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 flex items-center gap-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/50 rounded-bl-full -mr-10 -mt-10 transition-all group-hover:scale-110" />
                <div className="w-24 h-24 bg-slate-50 rounded-3xl border-2 border-slate-100 flex items-center justify-center overflow-hidden p-2 relative z-10">
                  {productImage ? (
                    productImage.startsWith('/') || productImage.startsWith('http') ? (
                      <img src={productImage} alt="Preview" className="w-full h-full object-contain animate-in zoom-in duration-300" />
                    ) : (
                      <div className="text-4xl animate-in zoom-in duration-300">{productImage}</div>
                    )
                  ) : (
                    <Package size={40} className="text-slate-200" />
                  )}
                </div>
                <div className="flex-1 relative z-10">
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1 block">Producto Detectado</span>
                  <p className="text-xl font-mono font-black text-slate-900 tracking-tighter">{barcode}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Listo para Inventariar</span>
                  </div>
                </div>
              </div>

              {/* Formulario */}
              <div className="space-y-5">
                <div className="group">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block">Nombre del Producto</label>
                  <input
                    required autoFocus
                    type="text"
                    placeholder="Ej. Yerba Mate 500g"
                    className="w-full bg-white border-2 border-slate-100 focus:border-blue-600 focus:ring-4 focus:ring-blue-50/50 rounded-[2rem] px-8 py-6 text-xl font-black text-slate-800 shadow-sm transition-all outline-none placeholder:text-slate-200"
                    value={form.name}
                    onChange={handleNameChange}
                  />

                  {/* Selector de Categoría */}
                  <div className="mt-4 px-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Rubro / Categoría</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                      {CATEGORIES_CONFIG.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, category: cat.id, isByWeight: cat.isWeight || false });
                          }}
                          className={`flex-shrink-0 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                            form.category === cat.id
                              ? 'bg-slate-900 text-white border-slate-900 shadow-xl shadow-slate-200'
                              : 'bg-white text-slate-400 border-slate-50 hover:border-slate-200'
                          }`}
                        >
                          {cat.icon} {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sugerencia Visual (Banner Unificado Carnes y Verduras) */}
                  {suggestedImage && productImage !== suggestedImage.value && (
                    <div className="mt-3 mx-2 p-3 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-xl border border-blue-200 overflow-hidden bg-white shadow-sm flex items-center justify-center">
                          {suggestedImage.type === 'image' ? (
                            <img src={suggestedImage.value} alt="Sugerencia" className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-4xl">{suggestedImage.value}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">
                            ¿Es {suggestedImage.key}?
                          </p>
                          <p className="text-[9px] text-blue-400 font-bold">
                            {suggestedImage.type === 'image' ? 'Tengo una foto lista' : 'Usar este ícono'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setProductImage(suggestedImage.value);
                          setForm(f => ({ ...f, category: suggestedImage.category, isByWeight: true }));
                          setSuggestedImage(null);
                          toast.info(`${suggestedImage.type === 'image' ? 'Foto' : 'Icono'} de ${suggestedImage.key} aplicado`);
                        }}
                        className="px-3 py-2 bg-blue-600 text-white text-[10px] font-black rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all uppercase"
                      >
                        {suggestedImage.type === 'image' ? 'USAR FOTO' : 'USAR ÍCONO'}
                      </button>
                    </div>
                  )}
                </div>

                <div className={`grid ${form.isByWeight ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block">Precio ($)</label>
                    <input
                      required type="number" step="0.01" inputMode="decimal"
                      className="w-full bg-white border-2 border-slate-100 focus:border-blue-600 rounded-3xl px-6 py-5 text-xl font-black text-slate-800 shadow-sm text-center outline-none"
                      value={form.price}
                      onChange={e => setForm({...form, price: e.target.value})}
                      placeholder="0.00"
                    />
                  </div>
                  {!form.isByWeight && (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block">Sumar Stock</label>
                      <input
                        type="number" step="1" inputMode="numeric"
                        className="w-full bg-white border-2 border-slate-100 focus:border-blue-600 rounded-3xl px-6 py-5 text-xl font-black text-slate-800 shadow-sm text-center outline-none"
                        value={form.stock}
                        onChange={e => setForm({...form, stock: e.target.value})}
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                {/* Switch Manual para Peso */}
                <div className="flex items-center justify-between px-4 py-4 bg-slate-50 rounded-[2rem] border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${form.isByWeight ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-400'}`}>
                      <Tag size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest leading-none mb-1">Venta por Peso</p>
                      <p className="text-[9px] text-slate-400 font-bold leading-none">Desactiva el stock unitario</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, isByWeight: !form.isByWeight })}
                    className={`w-12 h-6 rounded-full relative transition-all ${form.isByWeight ? 'bg-blue-600' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form.isByWeight ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Acciones */}
            <div className="mt-12 space-y-4 pb-6">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white font-black py-6 rounded-[2.5rem] shadow-2xl shadow-blue-200 active:scale-[0.97] transition-all flex items-center justify-center gap-4 text-lg tracking-tight"
              >
                {isLoading ? (
                  <Loader2 className="animate-spin" size={24} />
                ) : (
                  <>
                    <div className="bg-white/20 p-1.5 rounded-xl">
                      <Save size={22} />
                    </div>
                    <span>CONFIRMAR Y GUARDAR</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={resetToScan}
                className="w-full bg-transparent text-slate-400 font-black py-4 rounded-[2rem] text-[10px] uppercase tracking-[0.3em] active:text-red-500 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft size={14} />
                Descartar Cambios
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
