import { Toaster, toast } from 'sonner';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Store } from 'lucide-react';
import './App.css';
import Sidebar from './components/Sidebar';
import PosScreen from './screens/PosScreen';
import ProductsScreen from './screens/ProductsScreen';
import StockScreen from './screens/StockScreen';
import SettingsScreen from './screens/SettingsScreen';
import LandingScreen from './screens/LandingScreen';
import OnboardingScreen from './components/OnboardingScreen';
import ShiftOpeningScreen from './screens/ShiftOpeningScreen';
import ShiftCloseScreen from './screens/ShiftCloseScreen';
import BusinessHomeScreen from './screens/BusinessHomeScreen';
import SalesSummaryScreen from './screens/SalesSummaryScreen';
import LoginScreen from './screens/LoginScreen';
import ResetPasswordScreen from './components/ResetPasswordScreen';
import AccessKeyModal from './components/AccessKeyModal';
import DailySummaryScreen from './screens/DailySummaryScreen';
import CheckoutScreen from './components/CheckoutScreen';
import HelpScreen from './screens/HelpScreen';
import TermsScreen from './screens/TermsScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import EmailVerificationScreen from './screens/EmailVerificationScreen';
import MobileScannerScreen from './screens/MobileScannerScreen';
import { useNotifications } from './hooks/useNotifications';
import { isSpecialCategory } from './config/categories';
import NotificationBell from './components/NotificationBell';
import { ScannerProvider } from './context/ScannerContext.jsx';
import { useInventoryScan } from './context/scannerHooks.js';
import { API_BASE_URL } from './services/api';
import { hashPassword, verifyPassword } from './utils/passwordHash';
import {
  getFirebaseAnalytics,
  getFirebaseAuth,
  isFirebaseConfigured,
  loadFirebaseUserProfile,
  loadTenantState,
  reloadFirebaseUser,
  resendFirebaseVerification,
  signInFirebaseAccount,
  signOutFirebaseAccount,
  saveHybridProduct,
  listenProducts,
  listenSettings,
  deleteTenantProducts,
  listenSales,
  listenShifts,
  saveTenantSale,
  saveTenantShift,
  deleteTenantAccount
} from './services/firebase';

const TENANT_KEY = 'kiosco-pos-current-tenant';
const PRODUCTS_KEY = 'kiosco-pos-products';
const SETTINGS_KEY = 'kiosco-pos-settings';
const SHIFT_KEY = 'kiosco-pos-shift';
const SALES_KEY = 'kiosco-pos-sales';
const DEFAULT_TENANT_ID = 'demo-commerce';

function InventoryScanBridge({ onScan }) {
  useInventoryScan(onScan);
  return null;
}

const defaultSettings = {
  storeName: 'Mi Comercio',
  ownerName: '',
  ownerPasswordRecord: null,
  adminPasswordEnabled: false,
  plan: 'mercado',
  scalePrefix: '2',
  lowStockThreshold: 5,
  ticketFooter: '¡Gracias por su compra!',
};

function load(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved !== null ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function tenantStorageKey(key, tenantId) {
  return `${key}:${tenantId}`;
}

export default function App() {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT_ID);
  const [products, setProducts] = useState(() => {
    const tenant = localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT_ID;
    return load(tenantStorageKey(PRODUCTS_KEY, tenant), []);
  });
  const [settings, setSettings] = useState(() => {
    const tenant = localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT_ID;
    return load(tenantStorageKey(SETTINGS_KEY, tenant), defaultSettings);
  });
  const [cart, setCart] = useState([]);
  const [activeView, setActiveView] = useState('pos');
  const [appMode, setAppMode] = useState('public');
  const [registrationPlan, setRegistrationPlan] = useState('mercado');
  const [registrationData, setRegistrationData] = useState(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pendingView, setPendingView] = useState(null);
  const [failedAttempts, setFailedAttempts] = useState(0);

  // Migración de ownerPassword a ownerPasswordRecord y limpieza local
  useEffect(() => {
    async function migratePassword() {
      if (settings.ownerPassword) {
        const record = await hashPassword(settings.ownerPassword);
        setSettings(prev => {
          const newSettings = {
            ...prev,
            ownerPasswordRecord: record
          };
          delete newSettings.ownerPassword;
          return newSettings;
        });
      }
    }
    migratePassword();
  }, [settings.ownerPassword]);
  const [shiftState, setShiftState] = useState(() => {
    const tenant = localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT_ID;
    const saved = load(tenantStorageKey(SHIFT_KEY, tenant), { activeShiftId: null, shifts: [] });
    const storedActiveShiftId = localStorage.getItem('activeShiftId');
    return storedActiveShiftId && saved.shifts?.some((shift) => shift.id === storedActiveShiftId)
      ? { ...saved, activeShiftId: storedActiveShiftId }
      : saved;
  });
  const [sales, setSales] = useState(() => {
    const tenant = localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT_ID;
    return load(tenantStorageKey(SALES_KEY, tenant), []);
  });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isLoadingTenant, setIsLoadingTenant] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(() => isFirebaseConfigured);
  const [isProcessingVerification, setIsProcessingVerification] = useState(() => new URLSearchParams(window.location.search).get('verified') === '1');
  const [isRedirectedFromReset, setIsRedirectedFromReset] = useState(() => new URLSearchParams(window.location.search).get('login') === '1');
  const currentShift = shiftState.shifts.find((shift) => shift.id === shiftState.activeShiftId) || null;
  const tenantIdRef = useRef(tenantId);

  useEffect(() => {
    tenantIdRef.current = tenantId;
  }, [tenantId]);

  const resetLocalTenantState = (nextTenantId = DEFAULT_TENANT_ID) => {
    setProducts([]);
    setSales([]);
    setCart([]);
    setShiftState({ activeShiftId: null, shifts: [] });
    setSettings(defaultSettings);
    setTenantId(nextTenantId);
    setRegistrationData(null);
    setAdminUnlocked(false);
    localStorage.removeItem('activeShiftId');
    localStorage.removeItem('isCajaOpen');
    localStorage.removeItem(TENANT_KEY);
  };

  const { notifications, markAsRead } = useNotifications(products, settings, tenantId);

  const lastClosedShift = useMemo(() => {
    const closedShifts = sales.filter(s => s.type === 'shift-close');
    return closedShifts.length > 0 ? closedShifts[closedShifts.length - 1] : null;
  }, [sales]);

  useEffect(() => {
    getFirebaseAnalytics().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !isProcessingVerification) return undefined;
    const processVerificationReturn = async () => {
      try {
        const firebaseAuth = getFirebaseAuth();
        const user = firebaseAuth?.currentUser;
        if (!user) {
          setAppMode('login');
          return;
        }
        await user.reload();
        const profile = await loadFirebaseUserProfile(user.uid);
        const pendingRegistration = { ...profile, tenantId: user.uid, email: user.email, plan: profile?.plan || null };
        setRegistrationData(pendingRegistration);
        setTenantId(user.uid);
        localStorage.setItem(TENANT_KEY, user.uid);
        setAppMode(user.emailVerified ? 'checkout' : 'verify-email');
      } catch {
        setAppMode('login');
      } finally {
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsProcessingVerification(false);
      }
    };
    processVerificationReturn();
    return undefined;
  }, [isProcessingVerification]);

  useEffect(() => {
    if (isRedirectedFromReset) {
      // La URL de Firebase requiere sincronizar la vista después del montaje.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAppMode('login');
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsRedirectedFromReset(false);
    }
  }, [isRedirectedFromReset]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return undefined;
    }
    const firebaseAuth = getFirebaseAuth();
    return firebaseAuth.onAuthStateChanged(async (user) => {
      try {
        // Si estamos en la página de recuperación (o en la URL de acción de Firebase), no interferir con el flujo
        if (window.location.pathname === '/reset-password' || window.location.pathname === '/__/auth/action') {
          setIsAuthLoading(false);
          return;
        }

        if (!user || appMode === 'business') return;
        await user.reload();
        let profile = await loadFirebaseUserProfile(user.uid);
        if (!profile) return;

        const pendingRegistration = { ...profile, email: user.email, ownerPassword: undefined };
        if (tenantIdRef.current !== user.uid) {
          resetLocalTenantState(user.uid);
        }
        setRegistrationData(pendingRegistration);
        const isActive = profile.isActive || profile.status === 'active' || profile.subscriptionStatus === 'active';
        if (!user.emailVerified) {
          setAppMode('verify-email');
        } else if (!isActive) {
          setAppMode('checkout');
        } else {
          setAdminUnlocked(false);
          setAppMode('business');
          setActiveView('home');
        }
      } finally {
        setIsAuthLoading(false);
      }
    });
  }, [appMode]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isAuthLoading || isLoadingTenant || appMode !== 'business' || tenantId === DEFAULT_TENANT_ID) return;
    const firebaseAuth = getFirebaseAuth();
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.uid !== tenantId) return;

    localStorage.setItem(tenantStorageKey(PRODUCTS_KEY, tenantId), JSON.stringify(products));
  }, [products, tenantId, isAuthLoading, isLoadingTenant, appMode]);

  useEffect(() => {
    if (isAuthLoading || isLoadingTenant || appMode !== 'business' || tenantId === DEFAULT_TENANT_ID) return;
    const firebaseAuth = getFirebaseAuth();
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.uid !== tenantId) return;

    localStorage.setItem(tenantStorageKey(SETTINGS_KEY, tenantId), JSON.stringify(settings));
  }, [settings, tenantId, isAuthLoading, isLoadingTenant, appMode]);

  useEffect(() => {
    if (isAuthLoading || isLoadingTenant || appMode !== 'business' || tenantId === DEFAULT_TENANT_ID) return;
    const firebaseAuth = getFirebaseAuth();
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.uid !== tenantId) return;

    if (shiftState.shifts.length > 0) {
      localStorage.setItem(tenantStorageKey(SHIFT_KEY, tenantId), JSON.stringify(shiftState));
      if (shiftState.activeShiftId) {
        localStorage.setItem('activeShiftId', shiftState.activeShiftId);
      } else {
        localStorage.removeItem('activeShiftId');
      }
      localStorage.setItem('isCajaOpen', 'true');
    } else {
      localStorage.setItem(tenantStorageKey(SHIFT_KEY, tenantId), JSON.stringify({ activeShiftId: null, shifts: [] }));
      localStorage.removeItem('activeShiftId');
      localStorage.setItem('isCajaOpen', 'false');
    }
  }, [shiftState, tenantId, isAuthLoading, isLoadingTenant, appMode]);

  useEffect(() => {
    if (isAuthLoading || isLoadingTenant || appMode !== 'business' || tenantId === DEFAULT_TENANT_ID) return;
    const firebaseAuth = getFirebaseAuth();
    if (firebaseAuth?.currentUser && firebaseAuth.currentUser.uid !== tenantId) return;

    localStorage.setItem(tenantStorageKey(SALES_KEY, tenantId), JSON.stringify(sales));
  }, [sales, tenantId, isAuthLoading, isLoadingTenant, appMode]);

  useEffect(() => {
    if (!isFirebaseConfigured || isAuthLoading || isLoadingTenant || appMode !== 'business' || tenantId === DEFAULT_TENANT_ID) return undefined;

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== tenantId) return undefined;

    const subscribedTenantId = tenantId;
    const unsubProducts = listenProducts(tenantId, (fetchedProducts) => {
      if (tenantIdRef.current !== subscribedTenantId) return;
      setProducts(fetchedProducts);
    });

    const unsubSales = listenSales(tenantId, (fetchedSales) => {
      setSales(fetchedSales);
    });

    const unsubShifts = listenShifts(tenantId, (fetchedShifts) => {
      setShiftState(prev => ({
        ...prev,
        shifts: fetchedShifts,
        activeShiftId: prev.activeShiftId || (fetchedShifts.length > 0 ? fetchedShifts[0].id : null)
      }));
    });

    const unsubSettings = listenSettings(tenantId, (fetchedSettings) => {
      setSettings(prev => ({
        ...prev,
        ...fetchedSettings
      }));
    });

    return () => {
      unsubProducts();
      unsubSales();
      unsubShifts();
      unsubSettings();
    };
  }, [tenantId, isAuthLoading, isLoadingTenant, appMode]);

  // La sincronización ahora es en tiempo real vía onSnapshot en el efecto anterior
  // y mediante actualizaciones atómicas en handleCheckout/saveProduct.

  const addToCart = (product, quantity = 1) => {
    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex((item) => item.id === product.id);
      const currentQtyInCart = existingIndex >= 0 ? prevCart[existingIndex].quantity : 0;
      const newQuantity = currentQtyInCart + quantity;

      const skipStockCheck = product.isByWeight || isSpecialCategory(product.category);

      if (!skipStockCheck && newQuantity > (product.stock ?? 0)) {
        toast.error("Stock insuficiente para agregar más unidades");
        return prevCart;
      }

      if (existingIndex >= 0) {
        return prevCart.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: newQuantity } : item
        );
      }
      return [...prevCart, { ...product, quantity }];
    });
  };

  const removeFromCart = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const updateCartQuantity = (id, quantity) => {
    const nextQuantity = Number(quantity);
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      removeFromCart(id);
      return;
    }

    const product = products.find((p) => p.id === id);
    const skipStockCheck = product && (product.isByWeight || isSpecialCategory(product.category));

    if (product && !skipStockCheck && nextQuantity > (product.stock ?? 0)) {
      toast.error("Stock insuficiente para agregar más unidades");
      return;
    }

    setCart((previousCart) => previousCart.map((item) => (
      item.id === id ? { ...item, quantity: nextQuantity } : item
    )));
  };

  const toAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;
    const normalized = value.trim().replace(/[^\d,.-]/g, '');
    if (!normalized) return 0;
    const parsed = normalized.includes(',') && normalized.includes('.')
      ? Number(normalized.replace(/\./g, '').replace(',', '.'))
      : Number(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const handleCheckout = async (_total, paymentMethod, isInvoice = false, mpExternalReference = null, customItems = null) => {
    if (!currentShift) return false;
    const itemsToProcess = customItems || cart;
    const saleItems = itemsToProcess.map((item) => ({
      productId: item.id,
      name: item.name,
      quantity: toAmount(item.quantity),
      price: toAmount(item.price),
      isByWeight: item.isByWeight,
      category: item.category,
    }));

    const saleTotal = Math.round((saleItems.reduce((sum, item) => {
      const line = Math.round((item.price * item.quantity + Number.EPSILON) * 100) / 100;
      return sum + line;
    }, 0) + Number.EPSILON) * 100) / 100;

    let invoiceData = null;
    if (isInvoice) {
      try {
        const { solicitarCAE } = await import('./services/arca');
        const arcaConfig = { ...settings.arcaConfig, tenantId };
        const arcaResult = await solicitarCAE({ id: Date.now().toString(), total: saleTotal, items: saleItems }, arcaConfig);

        invoiceData = {
          isElectronic: true,
          status: arcaResult.status,
          cae: arcaResult.cae,
          vtoCae: arcaResult.caeVto,
          type: arcaResult.type,
          cuitEmisor: arcaResult.cuitEmisor,
          puntoVenta: arcaResult.puntoVenta,
          isSandbox: arcaResult.isSandbox
        };
      } catch (arcaError) {
        console.error("Error ARCA:", arcaError);
        toast.error(`No se pudo generar la Factura Electrónica: ${arcaError.message}`);
        return false; // Detener la venta si falló la factura solicitada
      }
    }

    const newSale = {
      id: Date.now().toString(),
      shiftId: currentShift.id,
      cashier: currentShift.cashier,
      total: saleTotal,
      paymentMethod,
      items: saleItems,
      createdAt: new Date().toISOString(),
      invoice: invoiceData,
      facturado: isInvoice,
      externalReference: mpExternalReference || (paymentMethod === 'qr_mp' ? `MP-${Date.now()}` : null)
    };

    if (paymentMethod === 'qr_mp' && mpExternalReference) {
      try {
        const currentUser = getFirebaseAuth()?.currentUser;
        if (!currentUser) throw new Error('Sesión de Firebase requerida');
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/confirm-qr-sale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sale: newSale, tenantId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo confirmar el pago QR');
      } catch (error) {
        console.error('Error confirmando venta QR:', error);
        toast.error(error.message || 'No se pudo confirmar el pago QR.');
        return false;
      }
    } else {

      // 1. Guardar venta y descontar stock atómicamente en Firebase
      if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
        try {
          const { processSaleTransaction } = await import('./services/firebase');
          await processSaleTransaction(tenantId, newSale);
        } catch (err) {
          console.error("Error en transacción de venta:", err);
          toast.error('Error al procesar la venta. Verificá tu conexión y el stock.');
          return false;
        }
      } else {
        // Fallback local para modo demo/offline sin Firebase
        setProducts((previousProducts) => previousProducts.map((p) => {
          const item = saleItems.find((i) => i.productId === p.id);
          if (!item) return p;
          if (p.isByWeight || isSpecialCategory(p.category)) return p;
          return { ...p, stock: Math.max(toAmount(p.stock) - item.quantity, 0) };
        }));
        setSales((previous) => [...previous, newSale]);
      }
    }

    if (isInvoice) {
      toast.success(`Venta cobrada por $${saleTotal.toFixed(2)}.\nFactura C generada ${invoiceData.isSandbox ? '(COMPROBANTE DE PRUEBA - NO VÁLIDO COMO FACTURA)' : ''}.\nCAE: ${invoiceData.cae}`);
    } else {
      toast.success(`Venta cobrada por $${saleTotal.toFixed(2)}. Stock actualizado.`);
    }
    setCart([]);
    return true;
  };

  const registerWithdrawal = (amount, note) => {
    if (!currentShift || amount <= 0) return;
    setShiftState((previous) => ({
      ...previous,
      shifts: previous.shifts.map((shift) => shift.id === currentShift.id
        ? { ...shift, withdrawals: [...(shift.withdrawals || []), { amount, note, createdAt: new Date().toISOString() }] }
        : shift),
    }));
  };

  const saveProduct = async (data, editingId = null) => {
    const isWeightOnlyCategory = isSpecialCategory(data.category);
    const name = String(data.name || '').trim();
    const price = Number(data.price);
    const stock = isWeightOnlyCategory ? null : Number(data.stock);

    if (!name || !Number.isFinite(price) || price < 0) {
      toast.error('Completá un nombre y precio válidos.');
      return false;
    }

    if (!isWeightOnlyCategory && (!Number.isFinite(stock) || stock < 0)) {
      toast.error('Completá un stock válido.');
      return false;
    }

    const isKiosco = settings.plan === 'kiosco';
    if (!data.isByWeight && !isWeightOnlyCategory && !Number.isInteger(stock)) {
      toast.error('El stock de productos por unidad debe ser un número entero.');
      return false;
    }
    if (isKiosco && data.isByWeight) {
      toast.error('El Plan Kiosco no permite productos por peso. Actualizá al Plan Mercado.');
      return false;
    }
    if (!editingId && isKiosco && products.length >= 300) {
      toast.error('Alcanzaste el límite de 300 productos del Plan Kiosco. Actualizá al Plan Mercado para cargar productos ilimitados.');
      return false;
    }

    const duplicate = products.find(
      (p) => data.barcode && p.barcode === data.barcode && p.id !== editingId
    );
    const duplicateReference = products.find(
      (p) => data.shortReference && p.shortReference === data.shortReference && p.id !== editingId
    );

    if (duplicate || duplicateReference) {
      toast.error(`Ya existe un producto con este código ("${(duplicate || duplicateReference).name}"). Modificá el existente en lugar de crear uno nuevo.`);
      return false;
    }

    // ID estable: priorizamos editingId, luego barcode, luego el id que ya traiga, y finalmente random
    const barcode = data.barcode ? String(data.barcode).trim() : null;
    const finalId = editingId || barcode || data.id || Date.now().toString();

    const productData = {
      ...data,
      id: finalId,
      barcode,
      name,
      price,
      stock,
      isByWeight: isKiosco ? false : data.isByWeight,
      category: isKiosco && isSpecialCategory(data.category)
        ? 'General'
        : data.category,
    };

    // 1. Guardar estado anterior para rollback
    const previousProducts = [...products];

    // 2. Actualización optimista: buscamos por editingId o por finalId
    const existsLocally = products.find(p => p.id === (editingId || finalId));
    if (existsLocally) {
      setProducts((prev) => prev.map((p) => (p.id === (editingId || finalId) ? { ...p, ...productData } : p)));
    } else {
      setProducts((prev) => [...prev, productData]);
    }

    // 3. Persistencia en Firebase
    if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
      try {
        await saveHybridProduct(tenantId, productData);
        return true;
      } catch (error) {
        console.error("Error al guardar producto en Firebase:", error);
        if (error.code === 'permission-denied') {
          toast.error("Error de permisos: No tenés autorización para editar productos.");
        } else {
          toast.error("Error de conexión: El producto no se guardó en la nube.");
        }
        setProducts(previousProducts); // Rollback
        return false;
      }
    }
    return true;
  };

  const handleInventoryScan = async (scan) => {
    const barcode = String(scan.barcode || '').trim();
    if (!barcode || !String(scan.name || '').trim() || !Number.isFinite(Number(scan.price))) return;

    const stockToAdd = scan.stock === '' ? 0 : Number(scan.stock);
    const existing = products.find((product) => product.barcode === barcode);

    const productData = {
      ...(existing || {}),
      name: String(scan.name).trim(),
      barcode,
      price: Number(scan.price),
      stock: (scan.isByWeight || existing?.isByWeight) ? null : Number(existing?.stock || 0) + stockToAdd,
      isByWeight: scan.isByWeight ?? Boolean(existing?.isByWeight),
      category: scan.category || existing?.category || 'General',
      updatedAt: new Date().toISOString()
    };

    const success = await saveProduct(productData, existing?.id || null);
    if (success) {
      toast.success(`Inventario actualizado: ${scan.name}`);
    }
  };

  const deleteProduct = async (id) => {
    const productToDelete = products.find(p => p.id === id);
    if (!productToDelete) return;

    if (window.confirm(`¿Estás seguro de que deseás eliminar "${productToDelete.name}"?`)) {
      try {
        const docId = productToDelete.barcode || productToDelete.id;
        if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
          await deleteTenantProducts(tenantId, [docId]);
        }
        setProducts((previousProducts) => previousProducts.filter((p) => p.id !== id));
        setCart((prev) => prev.filter((item) => item.id !== id));
        toast.success(`"${productToDelete.name}" eliminado correctamente.`);
      } catch {
        toast.error("Error al eliminar el producto. Revisá tu conexión.");
      }
    }
  };

  const deleteProducts = async (ids) => {
    if (!ids || ids.length === 0) return;
    if (window.confirm(`¿Estás seguro de que deseás eliminar los productos seleccionados?`)) {
      try {
        const docIds = ids.map(id => {
          const prod = products.find(p => p.id === id);
          return prod ? (prod.barcode || prod.id) : id;
        });

        if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
          await deleteTenantProducts(tenantId, docIds);
        }
        setProducts((previousProducts) => previousProducts.filter((p) => !ids.includes(p.id)));
        setCart((prev) => prev.filter((item) => !ids.includes(item.id)));
        toast.success(`${ids.length} productos eliminados correctamente.`);
      } catch {
        toast.error("Error al eliminar los productos. Revisá tu conexión.");
      }
    }
  };

  const updateStock = async (id, newStock) => {
    // 1. Actualización optimista local
    const previousProducts = [...products];
    const product = products.find(p => p.id === id);
    if (!product) return;

    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, stock: newStock } : p)));

    if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
      try {
        const docId = product.barcode || id;
        const currentStock = Number(product.stock || 0);
        const diff = newStock - currentStock;

        const { updateProductStockAtomic } = await import('./services/firebase');
        await updateProductStockAtomic(tenantId, docId, diff);
      } catch (error) {
        console.error("Error al actualizar stock en Firebase:", error);
        toast.error("Error de conexión: El stock no se guardó en la nube.");
        setProducts(previousProducts); // Rollback
      }
    }
  };

  const openShift = async (shift) => {
    const newShift = { id: Date.now().toString(), ...shift, registerName: shift.registerName || 'Caja 1', withdrawals: [] };
    if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
      await saveTenantShift(tenantId, newShift);
    }
    setShiftState((prev) => ({ activeShiftId: newShift.id, shifts: [...prev.shifts, newShift] }));
    localStorage.setItem('activeShiftId', newShift.id);
    localStorage.setItem('isCajaOpen', 'true');
    setAppMode('business');
    setActiveView('pos');
  };

  const openAdditionalShift = async (shift) => {
    const isKiosco = settings.plan === 'kiosco';
    const activeCount = shiftState.shifts.length;
    if (isKiosco) {
      toast.error('El Plan Kiosco solo permite 1 caja activa. Actualizá al Plan Mercado para operar múltiples puntos de venta.');
      return;
    }
    if (activeCount >= 3) {
      toast.error('Alcanzaste el límite de 3 cajas simultáneas del Plan Mercado.');
      return;
    }
    const nextRegisterNumber = activeCount + 1;
    const newShift = {
      id: Date.now().toString(),
      ...shift,
      registerName: shift.registerName || `Caja ${nextRegisterNumber}`,
      withdrawals: [],
    };
    if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
      await saveTenantShift(tenantId, newShift);
    }
    setShiftState((previous) => ({
      activeShiftId: newShift.id,
      shifts: [...previous.shifts, newShift],
    }));
    localStorage.setItem('activeShiftId', newShift.id);
    localStorage.setItem('isCajaOpen', 'true');
    setAppMode('business');
    setActiveView('pos');
  };

  const selectShift = (shiftId) => {
    setShiftState((previous) => ({ ...previous, activeShiftId: shiftId }));
    setCart([]);
    setActiveView('pos');
  };

  // --- LÓGICA DE EVALUACIÓN PEREZOSA (Upgrades, Downgrades) ---
  useEffect(() => {
    const runLazyBillingEvaluations = async () => {
      if (appMode !== 'business' || tenantId === DEFAULT_TENANT_ID || !settings.subscriptionId) return;

      const now = new Date();

      // 1. Verificar Downgrade Programado
      if (settings.scheduledDowngrade === 'kiosco' && settings.downgradeDate) {
        const downgradeExpiry = new Date(settings.downgradeDate);
        if (now > downgradeExpiry) {
          try {
            const { getOfflineFirestore } = await import('./services/firebase');
            const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
            const db = getOfflineFirestore();

            const finalUpdate = {
              plan: 'kiosco',
              scheduledDowngrade: null,
              downgradeDate: null,
              updatedAt: serverTimestamp()
            };

            await Promise.all([
              updateDoc(doc(db, 'tenants', tenantId), finalUpdate),
              updateDoc(doc(db, 'users', tenantId), finalUpdate)
            ]);

            setSettings(prev => ({ ...prev, ...finalUpdate }));
            toast.info("Tu suscripción ha vuelto al Plan Kiosco según lo programado.");
          } catch (err) {
            console.error("Error al procesar downgrade automático:", err);
          }
        }
      }
    };

    runLazyBillingEvaluations();
  }, [settings, tenantId, appMode]);

  // --- LÓGICA DE CIERRE MEJORADA ---
  const closeShift = async (closingData) => {
    if (!currentShift) return;
    const shiftId = currentShift.id;

    const shiftSales = sales.filter((sale) => sale.shiftId === shiftId && sale.type !== 'shift-close');
    const shiftTotal = shiftSales.reduce((sum, sale) => sum + sale.total, 0);

    const closeRecord = {
      id: `close-${shiftId}-${Date.now()}`,
      type: 'shift-close',
      shiftId: shiftId,
      ...currentShift,
      ...closingData,
      total: shiftTotal,
      closedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured && tenantId !== DEFAULT_TENANT_ID) {
      await saveTenantSale(tenantId, closeRecord);
      const { deleteTenantShift } = await import('./services/firebase');
      await deleteTenantShift(tenantId, shiftId);
    }

    setShiftState((previous) => {
      const remaining = previous.shifts.filter((shift) => shift.id !== shiftId);
      return {
        activeShiftId: remaining.length > 0 ? remaining[0].id : null,
        shifts: remaining,
      };
    });

    setCart([]);
    setPendingView(null);
    setAppMode('business');
    setActiveView('pos');
  };

  const activateAccount = async (selectedPlan = registrationData?.plan || 'mercado') => {
    const data = registrationData;
    if (!data) return;

    const currentTenantId = data.tenantId || tenantId;

    // Limpiar estados antes de activar para evitar heredar datos de otros tenants
    setProducts([]);
    setSales([]);
    setShiftState({ activeShiftId: null, shifts: [] });
    setCart([]);

    setTenantId(currentTenantId);
    localStorage.setItem(TENANT_KEY, currentTenantId);

    setAdminUnlocked(false);
    setSettings((previous) => ({
      ...previous,
      tenantId: currentTenantId,
      storeName: data.storeName || previous.storeName,
      ownerName: data.ownerName || data.fullName || previous.ownerName,
      ownerPassword: '',
      adminPasswordEnabled: false,
      plan: selectedPlan,
      phone: data.phone || previous.phone,
      email: data.email || previous.email,
      status: 'active',
      isActive: true,
      subscriptionStatus: 'active',
      activatedAt: new Date().toISOString(),
    }));
    setAppMode('business');
    setActiveView('home');
  };

  const handleLogin = async (loginData) => {
    const { email, password, keepLogged } = loginData;

    if (isFirebaseConfigured) {
      setIsLoadingTenant(true);
      try {
        const account = await signInFirebaseAccount(email, password, keepLogged);
        if (account) {
          let profile = account.profile || {};

          if (!account.user.emailVerified) {
            setRegistrationData({ ...profile, tenantId: account.tenantId, email });
            setIsLoadingTenant(false);
            setAppMode('verify-email');
            return { ok: true };
          }

          const isActive = profile.isActive || profile.status === 'active' || profile.subscriptionStatus === 'active';

          if (!isActive) {
            setRegistrationData({ ...profile, tenantId: account.tenantId, email });
            setIsLoadingTenant(false);
            setAppMode('checkout');
            return { ok: true };
          }

          // Limpiar estados antes de hidratar el nuevo tenant
          setProducts([]);
          setSales([]);
          setShiftState({ activeShiftId: null, shifts: [] });
          setCart([]);

          setTenantId(account.tenantId);
          localStorage.setItem(TENANT_KEY, account.tenantId);

          let tenantState = null;
          try {
            tenantState = await Promise.race([
              loadTenantState(account.tenantId),
              new Promise((resolve) => window.setTimeout(() => resolve(null), 8000)),
            ]);
          } catch {
            tenantState = null;
          }

          const forcedPlan = tenantState?.settings?.plan || profile.plan || 'kiosco';

          setSettings((previous) => {
            const newSettings = {
              ...previous,
              ...(tenantState?.settings || {}),
              plan: forcedPlan,
              activatedAt: tenantState?.settings?.activatedAt || profile.activatedAt || profile.createdAt
            };
            delete newSettings.ownerPassword;
            return newSettings;
          });

          setProducts(tenantState?.products || []);
          setSales(tenantState?.sales || []);
          const loadedShifts = tenantState?.shifts || (tenantState?.shift ? [tenantState?.shift] : []);
          setShiftState({
            activeShiftId: tenantState?.activeShiftId || loadedShifts[0]?.id || null,
            shifts: loadedShifts,
          });

          setIsLoadingTenant(false);
          setAdminUnlocked(false);
          setAppMode('business');
          setActiveView('home');
          return { ok: true };
        }
      } catch (error) {
        setIsLoadingTenant(false);
        const messages = {
          'auth/invalid-credential': 'Email o contraseña incorrectos.',
          'auth/user-not-found': 'No existe una cuenta con ese email.',
          'auth/wrong-password': 'La contraseña es incorrecta.',
        };
        const message = messages[error.code] || `Firebase respondió ${error.code || 'un error desconocido'}.`;
        return { ok: false, message };
      }
    } else if (settings.email && email.toLowerCase() !== settings.email.toLowerCase()) {
      return { ok: false, message: 'El email no coincide con la cuenta local.' };
    } else {
      const isCorrect = await verifyPassword(password, settings.ownerPasswordRecord);
      if (!isCorrect) {
        return { ok: false, message: 'La contraseña local es incorrecta.' };
      }
    }
    setAdminUnlocked(false);
    setAppMode('business');
    setActiveView('home');
    return { ok: true };
  };

  const handleLogout = async () => {
    try {
      await signOutFirebaseAccount();
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
    resetLocalTenantState();
    setAppMode('public');
    setActiveView('home');
  };

  const handleCancelAccount = async () => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    const uidToDelete = user?.uid || tenantId;

    if (!uidToDelete || uidToDelete === DEFAULT_TENANT_ID) {
      toast.error("No se encontró una sesión activa para cancelar.");
      return;
    }

    if (!window.confirm("¿Estás seguro de que deseas cancelar? Se eliminarán permanentemente tu cuenta y los datos que ingresaste.")) return;

    const loadingToast = toast.loading("Eliminando cuenta y datos...");
    setIsAuthLoading(true);
    try {
      await deleteTenantAccount(uidToDelete);
      toast.success("Cuenta y datos eliminados correctamente.", { id: loadingToast });
      resetLocalTenantState();
      setAppMode('public');
    } catch (error) {
      console.error("Error al cancelar cuenta:", error);
      toast.error("Error al eliminar los datos. Por seguridad, cerrá sesión e intentá de nuevo.", { id: loadingToast });
      handleLogout();
    } finally {
      setIsAuthLoading(false);
    }
  };

  const protectedViews = ['products', 'stock', 'settings', 'daily-summary'];
  const adminProtectionEnabled = settings.adminPasswordEnabled === true && Boolean(settings.ownerPasswordRecord);

  const navigateToView = (view) => {
    if (view === 'stock' && adminUnlocked && ['products', 'stock'].includes(activeView)) {
      setActiveView(view);
      return;
    }
    if (view === 'products' && adminUnlocked && ['products', 'stock'].includes(activeView)) {
      setActiveView(view);
      return;
    }
    if (protectedViews.includes(view) && adminProtectionEnabled && !adminUnlocked) {
      setPendingView(view);
      return;
    }
    setActiveView(view);
  };

  const unlockAdminView = async (password) => {
    if (!adminProtectionEnabled) return false;

    const isCorrect = await verifyPassword(password, settings.ownerPasswordRecord);

    if (!isCorrect) {
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      return {
        error: true,
        message: 'Clave incorrecta',
        lockout: newAttempts >= 5
      };
    }

    setFailedAttempts(0);
    setAdminUnlocked(true);
    setActiveView(pendingView || 'home');
    setPendingView(null);
    return true;
  };

  const planTheme = settings.plan === 'mercado' ? 'plan-mercado' : 'plan-kiosco';

  if (window.location.pathname === '/scan') return <MobileScannerScreen />;
  if (window.location.pathname === '/terms') return <TermsScreen onBack={() => window.location.href = '/'} />;
  if (window.location.pathname === '/privacy') return <PrivacyScreen onBack={() => window.location.href = '/'} />;
  if (window.location.pathname === '/reset-password') return <ResetPasswordScreen />;

  // Bypass para la URL de acción por defecto de Firebase
  if (window.location.pathname === '/__/auth/action') {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode === 'resetPassword') {
      return <ResetPasswordScreen />;
    }
    // Si en el futuro manejamos verificación de email personalizada:
    // if (mode === 'verifyEmail') return <EmailVerificationHandler />;
  }

  if (isAuthLoading) {
    return <div className="auth-loading" role="status" aria-live="polite"><div className="auth-spinner" /><p>Recuperando tu sesión...</p></div>;
  }

  if (isProcessingVerification) {
    return <div className="shift-page"><div className="shift-card"><div className="shift-icon">...</div><p className="eyebrow">PUNTOGESTIÓN</p><h1>Procesando verificación</h1><p className="shift-description">Estamos recuperando tu cuenta. Un momento.</p></div></div>;
  }

  if (appMode === 'public') return <LandingScreen onRegister={(plan) => { setRegistrationPlan(plan); setAppMode('register'); }} onLogin={() => setAppMode('login')} onNavigateTerms={() => setAppMode('terms')} onNavigatePrivacy={() => setAppMode('privacy')} />;
  if (appMode === 'terms') return <TermsScreen onBack={() => setAppMode('public')} />;
  if (appMode === 'privacy') return <PrivacyScreen onBack={() => setAppMode('public')} />;
  if (appMode === 'register') return <OnboardingScreen planElegido={registrationPlan} onBackToLogin={() => setAppMode('public')} onNavigateTerms={() => setAppMode('terms')} onNavigatePrivacy={() => setAppMode('privacy')} />;
  if (appMode === 'checkout' && registrationData) return <CheckoutScreen onBack={() => setAppMode('public')} onConfirm={activateAccount} onCancelAccount={handleCancelAccount} />;
  if (appMode === 'verify-email' && registrationData) return <EmailVerificationScreen email={registrationData.email} onCheck={async () => { const user = await reloadFirebaseUser(); if (!user?.emailVerified) return false; setAppMode('checkout'); return true; }} onResend={resendFirebaseVerification} onLogout={handleLogout} />;
  if (appMode === 'login') return <LoginScreen storeName={settings.storeName} onBack={() => setAppMode('public')} onLogin={handleLogin} />;

  if (appMode === 'business' && activeView === 'home') {
    return (
      <>
        <BusinessHomeScreen storeName={settings.storeName} ownerName={settings.ownerName} plan={settings.plan} onNavigate={navigateToView} onLogout={handleLogout} />
        {pendingView && <AccessKeyModal title="Acceso protegido" onConfirm={unlockAdminView} onClose={() => setPendingView(null)} />}
      </>
    );
  }

  if (protectedViews.includes(activeView) && adminProtectionEnabled && !adminUnlocked) {
    return <BusinessHomeScreen theme={planTheme} storeName={settings.storeName} ownerName={settings.ownerName} plan={settings.plan} onNavigate={navigateToView} onLogout={handleLogout} />;
  }

  return (
    <ScannerProvider tenantId={tenantId}>
    <Toaster position="top-center" richColors />
    <InventoryScanBridge onScan={handleInventoryScan} />
    <div className={`app-layout ${planTheme} min-h-screen h-[100dvh] flex flex-col md:flex-row overflow-hidden`}>
      <Sidebar
        activeView={activeView}
        onNavigate={(view) => {
          if (view === 'pos' && !currentShift) { navigateToView('pos'); return; }
          if (view === 'sales-summary' && !currentShift && !lastClosedShift) { navigateToView('pos'); return; }
          navigateToView(view);
        }}
        storeName={settings.storeName}
        adminUnlocked={adminUnlocked || !adminProtectionEnabled}
        salesOnly={['pos', 'sales-summary', 'close'].includes(activeView)}
        productsOnly={['products', 'stock'].includes(activeView)}
        settingsOnly={activeView === 'settings'}
        reportsOnly={activeView === 'daily-summary'}
        helpOnly={activeView === 'help'}
        onCloseShift={() => {
          const cartHasItems = cart.length > 0;
          const msg = cartHasItems
            ? "¿Desea cerrar el turno? Se perderán los productos actuales del carrito y se registrará el cierre."
            : "¿Confirma que desea cerrar el turno actual y la caja?";

          if (window.confirm(msg)) {
            closeShift({
              cashActual: 0,
              cashDifference: 0,
              closingNotes: "Cierre rápido desde menú lateral"
            });
          }
        }}
        onHome={() => setActiveView('home')}
      />
      <main className={`app-main flex-1 flex flex-col min-h-0 ${activeView === 'pos' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden touch-pan-y'}`}>

        {/* HEADER MODIFICADO: ELIMINADO EN POS PERO MANTENIENDO NOTIFICACIONES FLOTANTES AL LADO DE CONECTADO */}
        {activeView !== 'pos' ? (
          <header className="flex-none min-h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 z-20">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Store size={22} className="text-blue-600 md:hidden flex-shrink-0" />
                <span className="font-bold text-gray-800 md:hidden truncate max-w-[150px]">
                  {settings.storeName}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <NotificationBell notifications={notifications} onMarkAsRead={markAsRead} onNavigate={navigateToView} />
            </div>
          </header>
        ) : null}

        {activeView === 'pos' && currentShift && (
          <div className={`connection-banner ${isOnline ? 'online' : 'offline'} flex items-center justify-end gap-3 px-4 py-1 bg-[#f0fdf4] text-[#52796f] text-xs font-semibold`} role="status">
            <div className="flex items-center gap-1.5">
              <span className="connection-dot" />
              {isOnline ? 'Conectado' : 'Modo sin conexión: las ventas se sincronizarán al volver la red'}
            </div>
            <div className="flex items-center">
              <NotificationBell notifications={notifications} onMarkAsRead={markAsRead} onNavigate={navigateToView} />
            </div>
          </div>
        )}
        {!currentShift && activeView !== 'pos' && (
          <div className={`connection-banner ${isOnline ? 'online' : 'offline'}`} role="status">
            <span className="connection-dot" />
            {isOnline ? 'Conectado' : 'Modo sin conexión: las ventas se sincronizarán al volver la red'}
          </div>
        )}

        {activeView === 'pos' && (
          currentShift ? (
            <PosScreen
              products={products}
              cart={cart}
              sales={sales}
              settings={settings}
              tenantId={tenantId}
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              onUpdateCartQuantity={updateCartQuantity}
              onSetCart={setCart}
              onCheckout={handleCheckout}
              onSaveProduct={saveProduct}
              onRegisterWithdrawal={registerWithdrawal}
              currentShift={currentShift}
              shifts={shiftState.shifts}
              onSelectShift={selectShift}
              adminUnlocked={adminUnlocked}
              role={adminUnlocked || !adminProtectionEnabled ? 'owner' : 'cashier'}
              onCloseShift={() => {
                const cartHasItems = cart.length > 0;
                const msg = cartHasItems
                  ? "¿Desea cerrar el turno? Se perderán los productos actuales del carrito y se registrará el cierre."
                  : "¿Confirma que desea cerrar el turno actual y la caja?";

                if (window.confirm(msg)) {
                  closeShift({
                    cashActual: 0,
                    cashDifference: 0,
                    closingNotes: "Cierre rápido desde pantalla de ventas"
                  });
                }
              }}
            />
          ) : (
            <ShiftOpeningScreen
              plan={settings.plan}
              theme={planTheme}
              storeName={settings.storeName}
              onOpen={openShift}
              onBack={() => setActiveView('home')}
            />
          )
        )}
        {activeView === 'open-register' && (
          <ShiftOpeningScreen
            plan={settings.plan}
            theme={planTheme}
            storeName={settings.storeName}
            title="Agregar otro Punto de Venta"
            description="Abrí una segunda caja para cobrar en simultáneo."
            onOpen={openAdditionalShift}
            onBack={() => setActiveView('pos')}
          />
        )}
        {activeView === 'sales-summary' && (currentShift || lastClosedShift) && (
          <SalesSummaryScreen shift={currentShift || lastClosedShift} sales={sales} onBack={() => setActiveView('pos')} />
        )}
        {activeView === 'products' && (
          <ProductsScreen products={products} plan={settings.plan} storeName={settings.storeName} onSaveProduct={saveProduct} onDeleteProduct={deleteProduct} onDeleteProducts={deleteProducts} />
        )}
        {activeView === 'stock' && (
          <StockScreen products={products} settings={settings} onUpdateStock={updateStock} />
        )}
        {activeView === 'settings' && (
          <SettingsScreen key={tenantId} settings={settings} tenantId={tenantId} onSaveSettings={(nextSettings) => { setSettings(nextSettings); setAdminUnlocked(false); }} onAccountDeleted={() => { resetLocalTenantState(); setAppMode('public'); setActiveView('home'); }} />
        )}
        {activeView === 'daily-summary' && (
          <DailySummaryScreen sales={sales} products={products} onBack={() => setActiveView('home')} />
        )}
        {activeView === 'help' && <HelpScreen onBack={() => setActiveView('home')} />}
        {activeView === 'close' && (
          <ShiftCloseScreen shift={currentShift} sales={sales} onCloseShift={closeShift} onBack={() => setActiveView('pos')} />
        )}
      </main>
      {pendingView && <AccessKeyModal title="Acceso protegido" onConfirm={unlockAdminView} onClose={() => setPendingView(null)} />}
    </div>
    </ScannerProvider>
  );
}