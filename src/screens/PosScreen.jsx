import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Barcode, Search, Trash2, Camera, Banknote, LogOut, QrCode, FileText, X, AlertTriangle } from 'lucide-react';
import { isSpecialCategory } from '../config/categories';
import { toast } from 'sonner';
import BarcodeScanner from '../components/BarcodeScanner';
import ProductModal from '../components/ProductModal';
import { getFirebaseAuth, loadGlobalProduct, listenQrOrder } from '../services/firebase';
import { generateSalePDF, openPDFInNewTab } from '../services/pdfGenerator';
import { API_BASE_URL } from '../services/api';
import { ARCA_ENABLED, QR_MP_ENABLED } from '../config/features';

function ProductImage({ product }) {
  const [imageUrl, setImageUrl] = useState(product.imageUrl || product.image || null);

  useEffect(() => {
    let isMounted = true;
    if (!imageUrl && product.barcode) {
      loadGlobalProduct(product.barcode)
        .then((globalProduct) => {
          if (isMounted && globalProduct?.imageUrl) setImageUrl(globalProduct.imageUrl);
        })
        .catch(() => {});
    }
    return () => { isMounted = false; };
  }, [product.barcode, imageUrl]);

  if (imageUrl) {
    const isEmoji = imageUrl.length <= 4;
    if (isEmoji) {
      return (
        <div className="text-[48px] flex items-center justify-center w-full h-full">
          {imageUrl}
        </div>
      );
    }
    return <img src={imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-contain" />;
  }
  return <div className="flex items-center justify-center w-full h-full text-slate-300"><Barcode size={40} /></div>;
}

export default function PosScreen({
  products,
  cart,
  sales = [],
  settings,
  tenantId,
  onAddToCart,
  onRemoveFromCart,
  onUpdateCartQuantity,
  onCheckout,
  onSaveProduct,
  onRegisterWithdrawal,
  currentShift,
  shifts = [],
  onSelectShift,
  onNavigate,
  role,
  onCloseShift,
}) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prefillBarcode, setPrefillBarcode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);
  const [withdrawal, setWithdrawal] = useState({ amount: '', note: '' });
  const [catalogQuery, setCatalogQuery] = useState('');
  const [printTicket, setPrintTicket] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isMpLoading, setIsMpLoading] = useState(false);
  const [mpModalOpen, setMpModalOpen] = useState(false);
  const [weightProduct, setWeightProduct] = useState(null);
  const [weightInput, setWeightInput] = useState('');
  const [isElectronicInvoice, setIsElectronicInvoice] = useState(false);
  const [isCartMobileOpen, setIsCartMobileOpen] = useState(false);
  const [mpExternalRef, setMpExternalRef] = useState(null);
  const [pendingSale, setPendingSale] = useState(null);
  const [mpError, setMpError] = useState(null);
  const inputRef = useRef(null);
  const weightInputRef = useRef(null);
  const handleCheckoutRef = useRef(null);
  const saleProcessedRef = useRef(new Set());
  const isCheckingOutRef = useRef(false);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const closeMpModal = async (force = false) => {
    if (!force && mpExternalRef && !saleProcessedRef.current.has(mpExternalRef)) {
      const confirmCancel = window.confirm('¿Deseás cancelar esta orden de Mercado Pago? El QR dejará de ser válido.');
      if (!confirmCancel) return;

      try {
        const currentUser = getFirebaseAuth()?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          const registerName = currentShift?.registerName || '';
          const posIndex = parseInt(registerName.match(/\d+/)?.[0]) || 1;
          await fetch(`${API_BASE_URL}/api/qr-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              action: 'cancel',
              posIndex,
              externalReference: mpExternalRef
            })
          });
        }
      } catch (e) {
        console.error("Error al cancelar orden QR:", e);
      }
    }
    setMpModalOpen(false);
    setMpExternalRef(null);
    setIsMpLoading(false);
    setMpError(null);
  };

  useEffect(() => {
    if (!tenantId) return;
    const key = `pendingQrSale:${tenantId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const age = Date.now() - new Date(parsed.createdAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of pending sale
          setPendingSale(parsed);
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const refocus = () => {
      if (!isProductModalOpen && !isScannerOpen && !weightProduct) inputRef.current?.focus();
    };
    document.addEventListener('click', refocus);
    return () => document.removeEventListener('click', refocus);
  }, [isProductModalOpen, isScannerOpen, weightProduct, isMobile]);

  useEffect(() => {
    if (weightProduct) {
      const timer = setTimeout(() => {
        weightInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [weightProduct]);

  // Listen for Real-time QR payment updates from Firestore
  useEffect(() => {
    let unsubscribe = null;
    if (mpModalOpen && mpExternalRef && tenantId) {
      unsubscribe = listenQrOrder(tenantId, mpExternalRef, (order) => {
        // En QR V2 de Mercado Pago, la orden cambia a 'closed' cuando se completa el pago.
        // Nuestro webhook actualiza el documento en qr_orders/{externalReference} con status: 'closed'
        if (order.status === 'closed' || order.status === 'paid') {
          toast.success('¡Pago Aprobado por Mercado Pago!');
          handleCheckoutRef.current?.(false, false, mpExternalRef);
        } else if (order.status === 'rejected' || order.status === 'expired') {
          setMpError('La orden fue rechazada o expiró. Intente nuevamente.');
        }
      });
    }
    return () => { if (unsubscribe) unsubscribe(); };
  }, [mpModalOpen, mpExternalRef, tenantId]);

  const selectProduct = (product) => {
    if (product.isByWeight) {
      setWeightProduct(product);
      setWeightInput('');
      return;
    }
    onAddToCart(product);
  };

  const processCode = (rawCode) => {
    const code = rawCode.trim();
    if (!code) return false;

    const normalizedCode = code.replace(/^0+(?=\d)/, '');
    const sameBarcode = (productBarcode) => {
      const candidate = String(productBarcode || '').trim();
      return candidate === code || candidate === normalizedCode || candidate.replace(/^0+(?=\d)/, '') === normalizedCode;
    };

    const prefix = settings.scalePrefix || '2';
    const scaleFormat = settings.scaleFormat || 'weight';

    if (/^\d{13}$/.test(code) && code.startsWith(prefix)) {
      const plu = code.substring(2, 6);
      const valueStr = code.substring(7, 12);
      const product = products.find((p) => sameBarcode(p.barcode) || sameBarcode(plu));

      if (product) {
        const rawValue = parseInt(valueStr, 10);
        if (scaleFormat === 'weight') {
          // Si el código incluye el peso (ej: 01500 = 1.500kg)
          onAddToCart(product, rawValue / 1000);
        } else {
          // Si el código incluye el precio total (ej: 01500 = $15.00)
          const totalPrice = rawValue / 100;
          const qty = Math.round((totalPrice / product.price) * 1000) / 1000;
          onAddToCart(product, qty);
        }
        return true;
      }
    }

    const found = products.find((p) => sameBarcode(p.barcode) || p.shortReference === code);
    if (found) {
      selectProduct(found);
      return true;
    }
    toast.error(`Producto no encontrado para el código ${code}. Cargalo primero en Productos.`);
    return false;
  };

  const confirmWeight = (event) => {
    event.preventDefault();
    const quantity = Number(String(weightInput).replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    onAddToCart(weightProduct, quantity);
    setWeightProduct(null);
    setWeightInput('');
  };

  const openNewProductModal = (barcode = '') => {
    setPrefillBarcode(barcode);
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    setBarcodeInput('');
    setCatalogQuery('');

    if (!processCode(code)) {
      const textMatches = products.filter((product) => [product.name, product.barcode, product.shortReference]
        .filter(Boolean)
        .some((value) => normalizeSearch(value).includes(normalizeSearch(code))));
      if (textMatches.length === 1) {
        selectProduct(textMatches[0]);
        return;
      }
      if (textMatches.length > 1) {
        setCatalogQuery(code);
        return;
      }
      if (role === 'owner') openNewProductModal(code);
      else toast.error('Producto no encontrado. Solicitá al dueño que lo cargue en Productos.');
    }
  };

  const handleCameraScan = (code) => {
    setIsScannerOpen(false);
    if (!processCode(code)) {
      if (role === 'owner') openNewProductModal(code);
      else toast.error('Producto no encontrado. Solicitá al dueño que lo cargue en Productos.');
    }
  };

  const handleSave = (data) => {
    const ok = onSaveProduct(data, editingProduct?.id ?? null);
    if (ok) {
      setIsProductModalOpen(false);
      setEditingProduct(null);
      setPrefillBarcode('');
    }
  };

  const toNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;
    const normalized = value.trim().replace(/[^\d,.-]/g, '');
    if (!normalized) return 0;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    const numberValue = hasComma && hasDot
      ? Number(normalized.replace(/\./g, '').replace(',', '.'))
      : hasComma
        ? Number(normalized.replace(',', '.'))
        : Number(normalized);
    return Number.isFinite(numberValue) ? numberValue : 0;
  };

  const getLineTotal = (item) => {
    const price = toNumber(item.price);
    const qty = toNumber(item.quantity);
    return Math.round((price * qty + Number.EPSILON) * 100) / 100;
  };

  const cartLines = cart.map((item) => ({ ...item, lineTotal: getLineTotal(item) }));
  const total = Math.round((cartLines.reduce((acc, item) => acc + item.lineTotal, 0) + Number.EPSILON) * 100) / 100;
  const itemCount = cart.reduce((count, item) => count + Number(item.quantity), 0);
  const formatCurrency = (value) => `$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const threshold = settings.lowStockThreshold ?? 5;

  const stockStatus = (product) => {
    if (product.isByWeight || isSpecialCategory(product.category)) {
      return 'ok';
    }
    const s = product.stock ?? 0;
    if (s <= 0) return 'out';
    if (s <= threshold) return 'low';
    return 'ok';
  };

  const normalizeSearch = (value) => String(value)
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const filteredProducts = React.useMemo(() => {
    const query = catalogQuery.trim();
    if (!query) return products;

    const exactRefMatch = products.filter(p => p.shortReference && p.shortReference === query);
    if (exactRefMatch.length > 0) {
      return exactRefMatch;
    }

    const normalizedQuery = normalizeSearch(query);
    return products.filter((product) => {
      return [product.name, product.barcode, product.shortReference]
        .filter(Boolean)
        .some((value) => normalizeSearch(value).includes(normalizedQuery));
    });
  }, [products, catalogQuery]);

  const handleWithdrawal = (event) => {
    event.preventDefault();
    const amount = Number(withdrawal.amount) || 0;
    if (amount <= 0) return;
    onRegisterWithdrawal(amount, withdrawal.note.trim());
    setWithdrawal({ amount: '', note: '' });
    setIsWithdrawalOpen(false);
  };

  const handleCheckout = async (shouldPrint = false, viewPDF = false, mpExtRef = null, customItems = null) => {
    if (isCheckingOut || isCheckingOutRef.current) return false;
    const itemsToVerify = customItems || cart;
    if (itemsToVerify.length === 0) return false;

    if (mpExtRef && saleProcessedRef.current.has(mpExtRef)) return false;

    setIsCheckingOut(true);
    isCheckingOutRef.current = true;
    if (mpExtRef) {
      saleProcessedRef.current.add(mpExtRef);
      setMpError(null);
    }

    try {
      const method = mpExtRef ? 'qr_mp' : paymentMethod;
      const saleData = {
        storeName: settings.storeName,
        cashier: currentShift.cashier,
        shift: currentShift.shift,
        items: customItems ? customItems.map(item => ({ ...item, lineTotal: getLineTotal(item) })) : cartLines,
        total: customItems ? customItems.reduce((acc, item) => acc + getLineTotal(item), 0) : total,
        paymentMethod: method,
        createdAt: new Date(),
        externalReference: mpExtRef
      };

      if (shouldPrint) {
        setPrintTicket(saleData);
      }

      if (viewPDF) {
        const pdf = await generateSalePDF(saleData, settings);
        openPDFInNewTab(pdf);
      }

      const ok = await onCheckout(saleData.total, method, isElectronicInvoice, mpExtRef, customItems);
      if (ok === false) {
        if (mpExtRef) {
          saleProcessedRef.current.delete(mpExtRef);
          setMpError("No se pudo confirmar el pago. Verificá si el dinero ya ingresó a tu cuenta.");
        }
        return false;
      }

      if (mpExtRef) {
        localStorage.removeItem(`pendingQrSale:${tenantId}`);
        closeMpModal(true);
      }

      if (shouldPrint) window.setTimeout(() => window.print(), 120);
      return true;
    } catch (error) {
      console.error("Error en checkout:", error);
      const msg = "Hubo un problema al registrar la venta";
      toast.error(msg);
      if (mpExtRef) {
        saleProcessedRef.current.delete(mpExtRef);
        setMpError(msg);
      }
      return false;
    } finally {
      setIsCheckingOut(false);
      isCheckingOutRef.current = false;
      // Limpiar factura para la próxima venta
      setIsElectronicInvoice(false);
    }
  };

  // El polling necesita siempre la versión más reciente del handler.
  useEffect(() => {
    handleCheckoutRef.current = handleCheckout;
  });

  const handleMercadoPagoQR = async () => {
    if (cart.length === 0) {
      toast.error('El carrito está vacío');
      return;
    }

    if (!tenantId || tenantId === 'demo-commerce') {
      toast.error('La integración con Mercado Pago no está disponible en modo Demo.');
      return;
    }

    const config = settings.mercadoPagoConfig;

    if (!config?.habilitado) {
      toast.error('Configuración de Mercado Pago incompleta. Ve a Configuración.');
      return;
    }

    const registerName = currentShift?.registerName || '';
    const posIndex = parseInt(registerName.match(/\d+/)?.[0]) || 1;

    // Buscar la configuración específica para esta caja
    const specificConfig = settings.mercadoPagoConfig?.qrConfigs?.[posIndex] || settings.mercadoPagoConfig?.qrConfigs?.[1];

    if (!specificConfig) {
      toast.error(`No hay un QR configurado para la ${registerName || 'Caja 1'}. Ve a Configuración.`);
      return;
    }

    const externalReference = `pos-${tenantId}-${Date.now()}`;
    setMpExternalRef(externalReference);
    setMpModalOpen(true);

    try {
      const currentUser = getFirebaseAuth()?.currentUser;
      if (!currentUser) throw new Error('Sesión de Firebase requerida');
      const token = await currentUser.getIdToken();

      const payload = {
        action: 'create',
        posIndex,
        externalReference,
        items: cart.map(item => ({
          productId: item.id,
          quantity: Number(item.quantity)
        })),
        shiftId: currentShift?.id,
        cashier: currentShift?.cashier
      };

      const response = await fetch(`${API_BASE_URL}/api/qr-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'POS_NOT_FOUND' || data.code === 'POS_CONFIG_NOT_FOUND') {
          toast.error("La caja QR no está lista", {
            description: data.error || "Configurala en Ajustes para poder cobrar.",
            action: {
              label: "Ir a Ajustes",
              onClick: () => onNavigate?.('settings')
            },
            duration: 8000
          });
          setMpError("Caja no configurada. Por favor, revisá los Ajustes.");
        }
        throw new Error(data.error || 'Error al generar orden QR');
      }

      setMpError(null);

      localStorage.setItem(`pendingQrSale:${tenantId}`, JSON.stringify({
        externalReference,
        items: [...cart],
        total,
        createdAt: new Date().toISOString()
      }));

      toast.success('Orden enviada al QR del mostrador.');
    } catch (error) {
      console.error("MP QR Error:", error);
      toast.error(error.message || 'No se pudo generar la orden. Reintente.');
      closeMpModal(true);
    } finally {
      setIsMpLoading(false);
    }
  };


  if (!currentShift) return null;

  const shiftSales = (sales || []).filter((sale) => sale.shiftId === currentShift?.id && sale.type !== 'shift-close');
  const shiftTotal = shiftSales.reduce((sum, sale) => sum + sale.total, 0);
  const shiftCount = shiftSales.length;

  return (
    <div className="flex flex-col h-full w-full bg-gray-100 overflow-hidden select-none">
      <div className="flex flex-row flex-1 overflow-hidden min-h-0 p-2 gap-2 w-full">

        {/* Lado izquierdo: Buscador y Productos (AHORA CON MÁS ESPACIO Y MÁS ALTO) */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 pt-1">
          {pendingSale && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2 flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-3">
                <AlertTriangle className="text-amber-600" size={24} />
                <div>
                  <p className="text-sm font-bold text-amber-800">Venta QR pendiente detectada</p>
                  <p className="text-xs text-amber-600">Referencia: {pendingSale.externalReference} • {formatCurrency(pendingSale.total)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const ok = await handleCheckout(false, false, pendingSale.externalReference, pendingSale.items);
                    if (ok) {
                      toast.success('Venta pendiente confirmada');
                      setPendingSale(null);
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 rounded shadow-sm transition-colors"
                >
                  VERIFICAR PAGO
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem(`pendingQrSale:${tenantId}`);
                    setPendingSale(null);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 rounded transition-colors"
                >
                  DESCARTAR
                </button>
              </div>
            </div>
          )}
          <div className="flex-none flex flex-col gap-2 mb-2">

            {/* INFO DE CAJA MOVIDA AQUÍ PARA APROVECHAR ESPACIO */}
            <div className="hidden md:flex items-center gap-4 text-sm w-full animate-fade-in mb-1 bg-white/50 p-2 rounded-lg border border-gray-200 shadow-sm">
               <div className="flex items-center gap-2 bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-full font-bold">
                 <Banknote size={16} />
                 {currentShift.registerName || 'Caja'} • Turno {currentShift.shift}
               </div>
               <div className="text-gray-600 flex items-center gap-2">
                 <span className="font-bold text-gray-400 text-[10px] uppercase tracking-wider">Caja Inicial</span>
                 <span className="font-bold text-slate-700 bg-gray-100 px-2 py-0.5 rounded">${Number(currentShift.openingCash || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
               </div>
               <div className="ml-auto flex items-center gap-2 mr-10">
                 <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Punto activo</span>
                 <select
                   className="border-gray-200 rounded text-sm py-1 font-bold text-slate-700 bg-gray-50 focus:ring-blue-500 cursor-pointer"
                   value={currentShift.id}
                   onChange={(e) => onSelectShift(e.target.value)}
                 >
                    {shifts.map(s => <option key={s.id} value={s.id}>{s.registerName || 'Caja'}</option>)}
                 </select>
               </div>
            </div>

            <div className="flex gap-2">
              <form onSubmit={handleBarcodeSubmit} className="search-bar flex-1 shadow-sm">
                <Barcode size={24} color="#4b5563" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Buscar por nombre, código o escanear..."
                  value={barcodeInput}
                  onChange={(e) => {
                    setBarcodeInput(e.target.value);
                    setCatalogQuery(e.target.value);
                  }}
                  autoFocus={!isMobile}
                />
                <button type="submit" className="px-4 rounded cursor-pointer">
                  <Search size={20} />
                </button>
              </form>
              <button
                className="btn-scan shadow-sm"
                onClick={() => setIsScannerOpen(true)}
                title="Escanear con cámara"
              >
                <Camera size={24} />
              </button>
            </div>
          </div>

          <div className="product-grid flex-1 overflow-y-auto min-h-0 pr-1">
            {filteredProducts.length === 0 ? (
              <p className="catalog-empty text-center text-gray-500 mt-10">No se encontraron productos.</p>
            ) : filteredProducts.map((product) => {
              const status = stockStatus(product);
              return (
                <div
                  key={product.id}
                  className={`product-card ${status === 'out' ? 'out' : ''}`}
                  onClick={() =>
                    status === 'out'
                      ? toast.error(`"${product.name}" no tiene stock.`)
                      : selectProduct(product)
                  }
                >
                  <div className="product-card-image">
                    <ProductImage product={product} />
                  </div>
                  <div className="card-top">
                    <div>
                      <strong className="block text-sm leading-tight mb-1">{product.name}</strong>
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">
                        {product.isByWeight ? 'Precio x Kilo' : 'Unidad'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto pt-1">
                    {product.isByWeight || isSpecialCategory(product.category) ? (
                      <p className="stock-badge ok bg-sky-50 text-sky-700 px-2 py-0.5 rounded text-[10px]">
                        Disponible al peso
                      </p>
                    ) : (
                      <p className={`stock-badge ${status} px-2 py-0.5 rounded text-[10px]`}>
                        Stock: {product.stock} u
                      </p>
                    )}
                    <p className="text-blue-600 font-bold mt-0.5 text-lg leading-none">
                      ${product.price}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lado derecho: Carrito (MÁS ANCHO Y MÁS ALTO) */}
        {!isMobile && (
          <div className="w-[380px] xl:w-[440px] flex-none flex flex-col bg-white rounded-lg shadow-xl overflow-hidden min-h-0 border border-gray-200 ml-2 mt-1">
            <div className="flex-1 flex flex-col min-h-0 p-1">
              <div className="cart-heading flex-none mb-0">
                <div className="cart-title">
                  <ShoppingCart size={18} />
                  <h2 className="text-sm font-bold text-slate-800">Venta Actual</h2>
                </div>
                <div className="cart-live-total text-right">
                  <span className="text-[9px] text-gray-500 uppercase font-bold">Total</span>
                  <strong className="block text-lg text-slate-800 tracking-tight">{formatCurrency(total)}</strong>
                </div>
              </div>
              <p className="cart-item-count flex-none text-[11px] text-gray-500 mb-0.5 border-b pb-0.5">
                {itemCount.toFixed(3).replace(/\.000$/, '')} {itemCount === 1 ? 'artículo' : 'artículos'} en la venta
              </p>
              <div className="cart-list flex-1 overflow-y-auto min-h-0 pr-1">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-60 py-10">
                    <ShoppingCart size={40} className="mb-2" />
                    <p className="text-sm">El carrito está vacío</p>
                  </div>
                ) : (
                  cartLines.map((item) => (
                    <div key={item.id} className="cart-item py-1 border-b border-gray-200 shrink-0 flex justify-between items-center gap-2 last:border-0">
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <span className="font-bold text-slate-800 text-[12px] leading-tight truncate">
                          {item.name}
                        </span>
                        <strong className="text-[13px] text-slate-900 mt-0.5">
                          {formatCurrency(item.lineTotal)}
                        </strong>
                      </div>
                      <div className="flex-none flex items-center gap-2">
                        <button onClick={() => onRemoveFromCart(item.id)} className="text-red-400 hover:text-red-600 transition-colors">
                          <Trash2 size={16}/>
                        </button>
                        <div className="flex items-center bg-gray-100 rounded-md p-0.5 border border-gray-200">
                          <button
                            type="button"
                            className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-slate-600 text-sm font-bold"
                            onClick={() => onUpdateCartQuantity?.(item.id, item.quantity - (item.isByWeight ? 0.001 : 1))}
                            disabled={item.quantity <= (item.isByWeight ? 0.001 : 1)}
                          >
                            -
                          </button>
                          <span className="text-[12px] font-bold min-w-[28px] text-center text-slate-800">
                            {Number(item.quantity).toFixed(item.isByWeight ? 3 : 0)}
                          </span>
                          <button
                            type="button"
                            className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-slate-600 text-sm font-bold"
                            onClick={() => onAddToCart(item, item.isByWeight ? 0.001 : 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="total-section flex-none bg-gray-50 p-1 border-t border-gray-200">
              <div className="mb-0.5">
                <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Medio de pago</span>
                <div className="grid grid-cols-3 gap-1">
                  <button className={`py-1 px-1 text-[9px] font-bold rounded border transition-all ${paymentMethod === 'cash' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`} onClick={() => setPaymentMethod('cash')}>EFECTIVO</button>
                  <button className={`py-1 px-1 text-[9px] font-bold rounded border transition-all ${paymentMethod === 'transfer' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`} onClick={() => setPaymentMethod('transfer')}>TRANSF.</button>
                  <button
                    className={`py-1 px-1 text-[9px] font-bold rounded border transition-all ${paymentMethod === 'card' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                    onClick={() => setPaymentMethod('card')}
                  >
                    TARJETA
                  </button>
                </div>
              </div>
              {QR_MP_ENABLED && settings.mercadoPagoConfig?.habilitado && (
                <button
                  className="w-full bg-[#009ee3] hover:bg-[#008ac9] text-white mt-0.5 py-1.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm transition-all active:scale-[0.98] disabled:opacity-50"
                  onClick={handleMercadoPagoQR}
                  disabled={cart.length === 0 || isCheckingOut || isMpLoading}
                >
                  <QrCode size={16} /> {isMpLoading ? 'GENERANDO QR...' : 'QR MERCADO PAGO'}
                </button>
              )}
              {ARCA_ENABLED && settings.arcaConfig?.habilitado && (
                <div className="bg-white p-0.5 rounded border border-gray-200 mb-0.5 shadow-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isElectronicInvoice}
                      onChange={(e) => setIsElectronicInvoice(e.target.checked)}
                      className="w-3 h-3 accent-blue-600"
                    />
                    <span className="text-[9px] font-bold text-slate-700">Factura Electrónica (ARCA)</span>
                  </label>
                </div>
              )}
              <button
                className="w-full bg-green-600 hover:bg-green-700 text-white py-1.5 rounded-lg font-bold text-sm shadow transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-0.5"
                onClick={() => handleCheckout(false)}
                disabled={cart.length === 0 || isCheckingOut}
              >
                {isCheckingOut ? 'PROCESANDO...' : 'COBRAR'}
              </button>
              <div className="grid grid-cols-2 gap-1 mt-0.5">
                <button
                  className="flex items-center justify-center py-0.5 text-[10px] font-bold rounded border border-blue-600 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  onClick={() => handleCheckout(true)}
                  disabled={cart.length === 0 || isCheckingOut}
                >
                  TICKET
                </button>
                <button
                  className="flex items-center justify-center gap-1 py-0.5 text-[10px] font-bold rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                  onClick={() => handleCheckout(false, true)}
                  disabled={cart.length === 0 || isCheckingOut}
                >
                  <FileText size={12} /> PDF
                </button>
              </div>

            </div>
          </div>
        )}

        {/* Botón flotante para el Carrito en Móviles */}
        {isMobile && cart.length > 0 && (
          <div className="fixed bottom-[60px] left-0 right-0 p-4 z-40 pointer-events-none flex justify-center">
            <button
              onClick={() => setIsCartMobileOpen(true)}
              className="pointer-events-auto bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 active:scale-95 transition-transform"
            >
              <div className="bg-white/20 w-8 h-8 rounded-full flex items-center justify-center font-bold">
                {itemCount.toFixed(itemCount % 1 === 0 ? 0 : 2)}
              </div>
              <span className="font-bold">Ver Carrito</span>
              <span className="font-bold border-l border-white/30 pl-3">{formatCurrency(total)}</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex-none bg-slate-800 text-white p-1.5 px-3 flex justify-between items-center w-full z-10 border-t border-slate-700 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-4 md:gap-8">
          <div className="flex flex-col border-r border-slate-700 pr-4 md:pr-8">
            <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Ventas del Turno</span>
            <span className="text-sm md:text-base text-sky-400 font-bold leading-tight">{formatCurrency(shiftTotal)}</span>
          </div>
          <div className="hidden sm:flex flex-col border-r border-slate-700 pr-8">
            <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Operaciones</span>
            <span className="text-base text-white font-bold leading-tight">{shiftCount}</span>
          </div>
          <div className="hidden lg:flex items-center gap-3">
            <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Recientes:</span>
            <div className="flex gap-2 overflow-x-auto py-0.5 no-scrollbar max-w-[300px]">
              {shiftSales.slice(-3).reverse().map((s) => (
                <div key={s.id} className="bg-slate-700 px-3 py-1 rounded-full text-[11px] font-bold text-slate-300 border border-slate-600 whitespace-nowrap">
                  {formatCurrency(s.total)}
                </div>
              ))}
              {shiftSales.length === 0 && <span className="text-xs text-slate-500 italic">Sin ventas</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded-lg text-[10px] md:text-xs flex items-center gap-2 transition-all font-bold shadow-md active:translate-y-px border border-slate-600"
            onClick={() => setIsWithdrawalOpen(true)}
          >
            <Banknote size={16} /> <span>Retiro de caja</span>
          </button>
        </div>
      </div>

      {isCartMobileOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white">
          <div className="flex-none flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <ShoppingCart className="text-blue-600" />
              <h2 className="text-lg font-bold">Tu Venta</h2>
            </div>
            <button onClick={() => setIsCartMobileOpen(false)} className="p-2 bg-gray-100 rounded-full">
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <ShoppingCart size={64} className="mb-4" />
                <p>El carrito está vacío</p>
              </div>
            ) : (
              cartLines.map((item) => (
                <div key={item.id} className="flex justify-between items-center py-4 border-b">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-800">{item.name}</h3>
                    <p className="text-sm text-blue-600 font-bold">{formatCurrency(item.lineTotal)}</p>
                    <p className="text-xs text-gray-500">
                      {item.quantity} {item.isByWeight ? 'kg' : 'un.'} x {formatCurrency(item.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => onRemoveFromCart(item.id)} className="text-red-500 p-2">
                      <Trash2 size={20} />
                    </button>
                    <div className="flex items-center bg-gray-100 rounded-lg p-1 border">
                      <button
                        className="w-10 h-10 flex items-center justify-center bg-white rounded shadow text-xl font-bold"
                        onClick={() => onUpdateCartQuantity?.(item.id, item.quantity - (item.isByWeight ? 0.001 : 1))}
                        disabled={item.quantity <= (item.isByWeight ? 0.001 : 1)}
                      >
                        -
                      </button>
                      <span className="w-12 text-center font-bold">
                        {Number(item.quantity).toFixed(item.isByWeight ? 3 : 0)}
                      </span>
                      <button
                        className="w-10 h-10 flex items-center justify-center bg-white rounded shadow text-xl font-bold"
                        onClick={() => onAddToCart(item, item.isByWeight ? 0.001 : 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex-none p-4 bg-gray-50 border-t">
            <div className="flex justify-between items-center mb-4">
              <span className="text-gray-600 font-bold">TOTAL</span>
              <span className="text-2xl font-black text-slate-900">{formatCurrency(total)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <button className={`py-3 text-xs font-bold rounded-xl border ${paymentMethod === 'cash' ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-white border-gray-300'}`} onClick={() => setPaymentMethod('cash')}>EFECTIVO</button>
              <button className={`py-3 text-xs font-bold rounded-xl border ${paymentMethod === 'transfer' ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-white border-gray-300'}`} onClick={() => setPaymentMethod('transfer')}>TRANSF.</button>
              <button
                className={`py-3 text-xs font-bold rounded-xl border ${paymentMethod === 'card' ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-white border-gray-300'}`}
                onClick={() => setPaymentMethod('card')}
              >
                TARJETA
              </button>
            </div>

            {QR_MP_ENABLED && settings.mercadoPagoConfig?.habilitado && (
              <button
                className="w-full bg-[#009ee3] text-white py-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-transform disabled:opacity-50 mb-4 flex items-center justify-center gap-3"
                onClick={() => {
                  setIsCartMobileOpen(false);
                  handleMercadoPagoQR();
                }}
                disabled={cart.length === 0 || isCheckingOut || isMpLoading}
              >
                <QrCode size={24} /> {isMpLoading ? 'GENERANDO...' : 'QR MERCADO PAGO'}
              </button>
            )}

            <button
              className="w-full bg-green-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-transform disabled:opacity-50 mb-2"
              onClick={() => {
                handleCheckout(false);
                setIsCartMobileOpen(false);
              }}
              disabled={cart.length === 0 || isCheckingOut}
            >
              {isCheckingOut ? 'PROCESANDO...' : 'FINALIZAR COBRO'}
            </button>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                className="py-3 font-bold border-2 border-blue-600 text-blue-600 rounded-xl active:scale-95 transition-transform"
                onClick={() => { handleCheckout(true); setIsCartMobileOpen(false); }}
              >
                IMPRIMIR
              </button>
              <button
                className="py-3 font-bold border-2 border-gray-300 text-gray-600 rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-2"
                onClick={() => { handleCheckout(false, true); setIsCartMobileOpen(false); }}
              >
                <FileText size={18} /> PDF
              </button>
            </div>

            <button
              className="w-full bg-red-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2 mb-2"
              onClick={() => {
                setIsCartMobileOpen(false);
                onCloseShift();
              }}
            >
              <LogOut size={18} /> CERRAR TURNO Y BLOQUEAR
            </button>
          </div>
        </div>
      )}

      {isProductModalOpen && role === 'owner' && (
        <ProductModal
          product={editingProduct}
          products={products}
          initialBarcode={prefillBarcode}
          plan={settings.plan}
          onSave={handleSave}
          onClose={() => {
            setIsProductModalOpen(false);
            setEditingProduct(null);
            setPrefillBarcode('');
          }}
        />
      )}

      {isScannerOpen && (
        <BarcodeScanner onScan={handleCameraScan} onClose={() => setIsScannerOpen(false)} />
      )}

      {weightProduct && (
        <div className="modal-overlay">
          <form className="modal-content weight-modal" onSubmit={confirmWeight}>
            <div className="modal-heading">
              <div><h3>Cantidad por peso</h3><p className="off-hint">{weightProduct.name} · ${weightProduct.price} por kg</p></div>
              <button type="button" className="btn-icon" onClick={() => setWeightProduct(null)} aria-label="Cerrar">×</button>
            </div>
            <label>Kilos a vender<input ref={weightInputRef} required type="number" min="0.001" step="0.001" inputMode="decimal" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="Ej. 0.300" /></label>
            <button className="btn-primary" type="submit">Agregar al carrito</button>
          </form>
        </div>
      )}

      {printTicket && <section className="print-ticket"><header><strong>{printTicket.storeName || 'PuntoGestión'}</strong><span>Ticket de venta</span></header><div>Turno: {printTicket.shift} · {printTicket.cashier}</div><div>{printTicket.createdAt.toLocaleString('es-AR')}</div><hr />{printTicket.items.map((item) => <div className="print-ticket-line" key={item.id}><span>{item.name}<small>{item.quantity} x ${Number(item.price).toLocaleString('es-AR')}</small></span><strong>$ {Number(item.lineTotal).toLocaleString('es-AR')}</strong></div>)}<hr /><div className="print-ticket-total"><span>Total</span><strong>$ {Number(printTicket.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></div><div>Medio de pago: {printTicket.paymentMethod}</div><footer>{settings.ticketFooter}</footer></section>}
      {isWithdrawalOpen && <div className="modal-overlay"><form className="modal-content withdrawal-form" onSubmit={handleWithdrawal}><div className="modal-heading"><h3>Retiro de efectivo</h3><button type="button" className="btn-icon" onClick={() => setIsWithdrawalOpen(false)}><LogOut size={18} /></button></div><label>Monto<input required type="number" min="0.01" step="0.01" value={withdrawal.amount} onChange={(e) => setWithdrawal({ ...withdrawal, amount: e.target.value })} /></label><label>Motivo / observación<input value={withdrawal.note} onChange={(e) => setWithdrawal({ ...withdrawal, note: e.target.value })} placeholder="Ej. Pago a proveedor" /></label><button className="btn-primary" type="submit">Guardar retiro</button></form></div>}

      {QR_MP_ENABLED && mpModalOpen && (
        <div className="modal-overlay !z-[100]">
          <div className="modal-content text-center max-w-sm">
            <div className="modal-heading">
              <h3 className="text-xl font-bold">Cobro con QR en Mostrador</h3>
              <button type="button" className="btn-icon" onClick={() => closeMpModal()}>×</button>
            </div>
            <div className="py-6 flex flex-col items-center">
              <div className="bg-white p-4 rounded-xl shadow-inner mb-4 border-2 border-dashed border-gray-200">
                {(() => {
                  const registerName = currentShift?.registerName || '';
                  const posIndex = parseInt(registerName.match(/\d+/)?.[0]) || 1;
                  const qrUrl = settings.mercadoPagoConfig?.qrConfigs?.[posIndex]?.qrImageUrl || settings.mercadoPagoConfig?.qrImageUrl;

                  return qrUrl ? (
                    <>
                      <img src={qrUrl} alt="QR Mercado Pago" className="w-[200px] h-[200px] object-contain mx-auto" />
                      <p className="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-widest">
                        ESCANEÁ EL QR DE LA {registerName.toUpperCase() || 'CAJA 1'}
                      </p>
                    </>
                  ) : (
                    <div className="w-[200px] h-[200px] flex items-center justify-center">
                       <QrCode size={40} className="animate-pulse text-gray-300" />
                    </div>
                  );
                })()}
              </div>
              <p className="text-sm text-gray-600 mb-1">Total a cobrar:</p>
              <p className="text-2xl font-black text-slate-800 mb-4">{formatCurrency(total)}</p>

              <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg animate-pulse">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {isCheckingOut ? 'Confirmando pago...' : 'Esperando escaneo del cliente...'}
                </span>
              </div>

              {mpError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-bold flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>{mpError}</span>
                  </div>
                </div>
              )}

              <div className="w-full flex flex-col gap-2">
                <button
                  disabled={isCheckingOut}
                  className="w-full py-4 bg-[#009ee3] hover:bg-[#008ac9] text-white rounded-xl font-black text-lg shadow-lg transition-all active:scale-95 mt-1 disabled:opacity-50"
                  onClick={async () => {
                    const ok = await handleCheckout(false, false, mpExternalRef);
                    if (ok) toast.success('Venta confirmada');
                  }}
                >
                  {isCheckingOut ? 'PROCESANDO...' : 'VERIFICAR PAGO'}
                </button>
              </div>
            </div>
            <button
              disabled={isCheckingOut}
              className="text-red-500 font-bold text-xs mt-2 hover:underline disabled:no-underline"
              onClick={() => closeMpModal()}
            >
              CANCELAR ORDEN QR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}