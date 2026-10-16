import { getApps, initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, reload, signOut, deleteUser } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  addDoc,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
  increment,
  orderBy,
  terminate,
  clearIndexedDbPersistence,
} from 'firebase/firestore';
import { API_BASE_URL } from './api';
import { shouldTrackStock, isSpecialCategory } from '../config/categories';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredConfigKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const hasFirebaseConfig = requiredConfigKeys.every((key) => Boolean(firebaseConfig[key]));
let firestore;
let firebaseApp;
let auth;
let analytics;

/**
 * Inicializa Firestore con persistencia offline cuando existe configuración Firebase.
 * El MVP sigue funcionando con localStorage si no hay variables VITE_FIREBASE_*.
 */
export function getOfflineFirestore() {
  if (!hasFirebaseConfig) return null;
  if (firestore) return firestore;

  const app = getFirebaseApp();
  try {
    firestore = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    // Si otra parte de la aplicación ya inicializó Firestore, reutilizar esa instancia.
    if (error.code !== 'failed-precondition' && error.code !== 'already-exists') throw error;
    firestore = getFirestore(app);
  }
  return firestore;
}

export function getFirebaseApp() {
  if (!hasFirebaseConfig) return null;
  if (!firebaseApp) {
    const apps = getApps();
    firebaseApp = apps.length > 0 ? apps[0] : initializeApp(firebaseConfig);
  }
  return firebaseApp;
}

export function getFirebaseAuth() {
  if (!hasFirebaseConfig) return null;
  if (auth) return auth;
  const app = getFirebaseApp();
  if (!app) return null;
  try {
    // Verificamos si ya existe una instancia de Auth para este app
    const existingAuth = getAuth(app);
    auth = existingAuth;
    setPersistence(auth, browserLocalPersistence).catch(() => {});
  } catch (error) {
    // Si falla por registro, devolvemos null preventivamente
    console.error('Error al obtener Firebase Auth:', error);
    return null;
  }
  return auth;
}

export async function updateTenantIntegrations(tenantId, data) {
  const database = getOfflineFirestore();
  if (!database) return;
  await setDoc(doc(database, 'tenants', tenantId, 'config', 'settings'), data, { merge: true });
}

export async function getFirebaseAnalytics() {
  if (!hasFirebaseConfig || !firebaseConfig.measurementId || analytics) return analytics;
  if (!(await isAnalyticsSupported())) return null;
  analytics = getAnalytics(getFirebaseApp());
  return analytics;
}

export async function createFirebaseAccount({ email, password, profile }) {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) return null;
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  const tenantId = credential.user.uid;
  await sendEmailVerification(credential.user, {
    url: `${window.location.origin}/?verified=1`,
    handleCodeInApp: false,
  });

  const safeProfile = { ...profile };
  delete safeProfile.ownerPassword;
  delete safeProfile.ownerPasswordRecord;

  const accountProfile = {
    status: 'pending_payment',
    isActive: false,
    createdAt: new Date().toISOString(),
    ...safeProfile,
    tenantId,
  };
  await Promise.all([
    setDoc(doc(getOfflineFirestore(), 'users', tenantId), accountProfile),
    setDoc(doc(getOfflineFirestore(), 'tenants', tenantId), accountProfile),
  ]);
  return { user: credential.user, tenantId, profile: accountProfile };
}

export async function signInFirebaseAccount(email, password, keepLogged = true) {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) return null;
  await setPersistence(firebaseAuth, keepLogged ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  await reload(credential.user);
  const profileSnapshot = await Promise.race([
    getDoc(doc(getOfflineFirestore(), 'users', credential.user.uid)),
    new Promise((resolve) => window.setTimeout(() => resolve(null), 5000)),
  ]).catch(() => null);
  return {
    user: credential.user,
    tenantId: credential.user.uid,
    profile: profileSnapshot?.exists() ? profileSnapshot.data() : null,
  };
}

export async function reloadFirebaseUser() {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) return null;
  await reload(firebaseAuth.currentUser);
  return firebaseAuth.currentUser;
}

export async function signOutFirebaseAccount() {
  const firebaseAuth = getFirebaseAuth();
  if (firebaseAuth) {
    await signOut(firebaseAuth);
  }

  // Limpiar persistencia de Firestore para evitar cruce de datos entre usuarios
  if (firestore) {
    try {
      await terminate(firestore);
      await clearIndexedDbPersistence(firestore);
      firestore = undefined; // Forzar reinicialización en el próximo getOfflineFirestore
    } catch (error) {
      console.error("Error al limpiar persistencia de Firestore:", error);
      // No bloqueamos el logout si esto falla (ej. otras pestañas abiertas)
      firestore = undefined;
    }
  }
}

export async function loadFirebaseUserProfile(userId) {
  const database = getOfflineFirestore();
  if (!database || !userId) return null;
  const profileSnapshot = await getDoc(doc(database, 'users', userId));
  return profileSnapshot.exists() ? profileSnapshot.data() : null;
}

/**
 * Fuerza la activación de una cuenta para testing/admin (bypass de pasarela de pago).
 */
export async function bypassPaymentForTesting(tenantId, plan) {
  const database = getOfflineFirestore();
  if (!database || !tenantId) return;
  const update = {
    isActive: true,
    status: 'active',
    subscriptionStatus: 'active',
    plan,
    activatedAt: new Date().toISOString(),
    updatedAt: serverTimestamp()
  };
  await Promise.all([
    setDoc(doc(database, 'users', tenantId), update, { merge: true }),
    setDoc(doc(database, 'tenants', tenantId), update, { merge: true }),
  ]);
  return update;
}

export async function resendFirebaseVerification() {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) throw new Error('auth/no-current-user');
  await sendEmailVerification(firebaseAuth.currentUser, {
    url: `${window.location.origin}/?verified=1`,
    handleCodeInApp: false,
  });
}

export async function activateFirebaseSubscription(tenantId, plan) {
  const database = getOfflineFirestore();
  if (!database || !tenantId) return null;
  const update = { isActive: true, status: 'active', plan, activatedAt: new Date().toISOString(), updatedAt: serverTimestamp() };
  await Promise.race([
    Promise.all([
    setDoc(doc(database, 'users', tenantId), update, { merge: true }),
    setDoc(doc(database, 'tenants', tenantId), update, { merge: true }),
    ]),
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('firestore/activation-timeout')), 8000)),
  ]);
  return update;
}

export async function saveTenantSale(tenantId, sale) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return;
  await setDoc(doc(database, 'tenants', tenantId, 'sales', sale.id), sale);
}

export async function updateTenantShiftState(tenantId, { shifts, activeShiftId }) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return;
  await setDoc(doc(database, 'tenants', tenantId, 'shifts', 'state'), { shifts, activeShiftId });
}

export async function syncTenantState(tenantId, { settings, products, sales, shifts = [], activeShiftId = null }) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return;

  const safeSettings = { ...settings };
  delete safeSettings.ownerPassword;
  delete safeSettings.ownerPasswordRecord;
  const writes = [
    setDoc(doc(database, 'tenants', tenantId, 'config', 'settings'), safeSettings, { merge: true }),
    ...products.map((product) => setDoc(doc(database, 'tenants', tenantId, 'products', product.barcode || product.id), product)),
    ...sales.map((sale) => setDoc(doc(database, 'tenants', tenantId, 'sales', sale.id), sale)),
  ];
  writes.push(setDoc(doc(database, 'tenants', tenantId, 'shifts', 'state'), { shifts, activeShiftId }));
  await Promise.all(writes);
}

export async function createScannerSession(tenantId, scannerSessionId, mode) {
  const database = getOfflineFirestore();
  if (!database) throw new Error('Firebase no está configurado.');
  await setDoc(doc(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId), {
    tenantId,
    sessionId: scannerSessionId,
    mode,
    barcode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function listenScannerSession(tenantId, scannerSessionId, onBarcode) {
  const database = getOfflineFirestore();
  if (!database) return () => {};
  return onSnapshot(collection(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = change.doc.data();
      if (change.type === 'added' && data.mode === 'pos') onBarcode(data, change.doc.id);
    });
  });
}

export async function publishScannerBarcode(tenantId, scannerSessionId, barcode) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scannerSessionId) throw new Error('Sesión de escáner inválida.');
  await addDoc(collection(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events'), {
    mode: 'pos',
    barcode,
    timestamp: serverTimestamp(),
  });
}

export async function clearScannerBarcode(tenantId, scannerSessionId, eventId) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scannerSessionId || !eventId) return;
  await deleteDoc(doc(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events', eventId));
}

export async function publishInventoryScan(tenantId, scannerSessionId, scan) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scannerSessionId) throw new Error('Sesión de escáner inválida.');
  await addDoc(collection(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events'), {
    mode: 'inventory',
    barcode: scan.barcode,
    name: scan.name,
    price: scan.price,
    stock: scan.stock,
    category: scan.category || 'General',
    isByWeight: scan.isByWeight || false,
    imageUrl: scan.imageUrl || '',
    timestamp: serverTimestamp(),
  });
}

export function listenInventoryScan(tenantId, scannerSessionId, onScan) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scannerSessionId) return () => {};
  return onSnapshot(collection(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = change.doc.data();
      if (change.type === 'added' && data.mode === 'inventory') onScan(data, change.doc.id);
    });
  });
}

export async function clearInventoryScan(tenantId, scannerSessionId, eventId) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scannerSessionId || !eventId) return;
  await deleteDoc(doc(database, 'tenants', tenantId, 'scanner_sessions', scannerSessionId, 'events', eventId));
}

export async function saveInventoryProduct(tenantId, product) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !product.barcode) throw new Error('No se pudo guardar el producto.');
  await setDoc(doc(database, 'tenants', tenantId, 'products', product.barcode), {
    ...product,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function findTenantProductByBarcode(tenantId, barcode) {
  const database = getOfflineFirestore();
  if (!database || !barcode) return null;

  const cleanBarcode = String(barcode).trim();
  const normalized = cleanBarcode.replace(/^0+(?=\d)/, '');

  // 1. Intento de lectura directa por ID (el barcode es el ID en la mayoría de los casos)
  // Probamos con el código tal cual y luego normalizado sin ceros iniciales
  try {
    const docRef = doc(database, 'tenants', tenantId, 'products', cleanBarcode);
    const snap = await getDoc(docRef);
    if (snap.exists()) return { id: snap.id, ...snap.data() };

    if (normalized !== cleanBarcode) {
      const normRef = doc(database, 'tenants', tenantId, 'products', normalized);
      const normSnap = await getDoc(normRef);
      if (normSnap.exists()) return { id: normSnap.id, ...normSnap.data() };
    }
  } catch {
    // Si falla por permisos o no existe, continuamos al fallback
  }

  // 2. Fallback a búsqueda por query (Requiere permisos de 'list', solo para el dueño)
  try {
    const result = await getDocs(query(
      collection(database, 'tenants', tenantId, 'products'),
      where('barcode', '==', cleanBarcode),
    ));
    if (result.docs[0]) return { id: result.docs[0].id, ...result.docs[0].data() };

    if (normalized !== cleanBarcode) {
      const normResult = await getDocs(query(
        collection(database, 'tenants', tenantId, 'products'),
        where('barcode', '==', normalized),
      ));
      if (normResult.docs[0]) return { id: normResult.docs[0].id, ...normResult.docs[0].data() };
    }
    return null;
  } catch (error) {
    console.error("Error en findTenantProductByBarcode:", error);
    return null;
  }
}

export async function saveScannedTenantProduct(tenantId, product, scannerSessionId) {
  const database = getOfflineFirestore();
  if (!database) throw new Error('Firebase no está configurado.');
  const productId = product.id || `${Date.now()}`;
  await setDoc(doc(database, 'tenants', tenantId, 'products', productId), {
    ...product,
    id: productId,
    scannerSessionId,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return productId;
}

export async function loadGlobalProduct(barcode) {
  if (!barcode || !getFirebaseAuth()?.currentUser) return null;
  const token = await getFirebaseAuth().currentUser.getIdToken();
  const response = await fetch(`${API_BASE_URL}/api/global-product?barcode=${encodeURIComponent(barcode)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('No se pudo consultar el catálogo global.');
  return response.json();
}

export async function saveHybridProduct(tenantId, product) {
  const database = getOfflineFirestore();
  if (!database) throw new Error('Firebase no está configurado.');
  if (!tenantId) throw new Error('Tenant ID no proporcionado.');

  const barcode = product.barcode ? String(product.barcode).trim() : null;
  const productId = barcode || product.id;
  if (!productId) throw new Error('El producto no tiene un ID válido.');

  // 1. Siempre persistir en el Tenant para asegurar la sincronización privada
  const tenantProduct = {
    ...product,
    id: productId, // Aseguramos que el ID interno coincida con el ID del documento
    barcode,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(database, 'tenants', tenantId, 'products', productId), tenantProduct, { merge: true });

  // 2. Sincronizar el catálogo global exclusivamente mediante el servidor/Admin SDK.
  const isValidBarcode = barcode && /^\d{7,}$/.test(barcode);
  if (!isValidBarcode) return;

  try {
    const token = await getFirebaseAuth().currentUser.getIdToken();
    await fetch(`${API_BASE_URL}/api/global-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ barcode, name: product.name || '', imageUrl: product.imageUrl || '' }),
    });
  } catch (err) { console.error("Global sync error:", err); }
}

export function listenQrOrder(tenantId, externalReference, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !externalReference) return () => {};

  const docRef = doc(database, 'tenants', tenantId, 'qr_orders', externalReference);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  }, (error) => {
    console.error("Error escuchando orden QR:", error);
  });
}

export function listenQrPayments(tenantId, externalReference, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId) return () => {};

  const q = query(
    collection(database, 'tenants', tenantId, 'qr_payments'),
    where('externalReference', '==', externalReference)
  );

  return onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added' || change.type === 'modified') {
        callback(change.doc.data());
      }
    });
  });
}

export function listenProducts(tenantId, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return () => {};

  const q = query(collection(database, 'tenants', tenantId, 'products'));
  return onSnapshot(q, (snapshot) => {
    const products = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));
    // Reemplazo total para evitar heredar stock de otros usuarios
    callback(products);
  }, (error) => {
    console.error("Error escuchando productos:", error);
  });
}

export function listenSettings(tenantId, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return () => {};

  const docRef = doc(database, 'tenants', tenantId, 'config', 'settings');
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  }, (error) => {
    console.error("Error escuchando configuración:", error);
  });
}

export async function deleteTenantProducts(tenantId, productIds) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !productIds || productIds.length === 0) return;
  const batch = writeBatch(database);
  productIds.forEach(id => {
    batch.delete(doc(database, 'tenants', tenantId, 'products', String(id).trim()));
  });
  await batch.commit();
}

export async function loadTenantState(tenantId) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return null;
  const tenantRef = (name) => collection(database, 'tenants', tenantId, name);
  const [settingsSnapshot, productsSnapshot, salesSnapshot, shiftStateSnapshot, legacyShiftSnapshot] = await Promise.all([
    getDoc(doc(database, 'tenants', tenantId, 'config', 'settings')),
    getDocs(tenantRef('products')),
    getDocs(tenantRef('sales')),
    getDoc(doc(database, 'tenants', tenantId, 'shifts', 'state')),
    getDoc(doc(database, 'tenants', tenantId, 'shifts', 'current')),
  ]);
  const shiftState = shiftStateSnapshot.exists() ? shiftStateSnapshot.data() : null;
  const shifts = shiftState?.shifts || (legacyShiftSnapshot.exists() ? [legacyShiftSnapshot.data()] : []);
  return {
    settings: settingsSnapshot.exists() ? settingsSnapshot.data() : null,
    products: productsSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })),
    sales: salesSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })),
    shifts,
    activeShiftId: shiftState?.activeShiftId || shifts[0]?.id || null,
  };
}

export async function deleteTenantAccount(tenantId) {
  const database = getOfflineFirestore();
  const firebaseAuth = getFirebaseAuth();
  if (!database || !tenantId) return;

  // 1. Obtener todas las referencias de colecciones anidadas
  const tenantRef = doc(database, 'tenants', tenantId);
  const collections = ['products', 'sales', 'shifts', 'scanner_sessions', 'config'];

  const batch = writeBatch(database);

  for (const collName of collections) {
    const collRef = collection(database, 'tenants', tenantId, collName);
    const snapshot = await getDocs(collRef);
    snapshot.forEach(d => {
      // Si es la colección config, hay que ir más profundo o borrar sus docs
      batch.delete(d.ref);
    });
  }

  // 2. Borrar documentos raíz en tenants y users
  batch.delete(doc(database, 'users', tenantId));
  batch.delete(tenantRef);

  // 3. Ejecutar borrado en Firestore
  await batch.commit();

  // 4. Intentar eliminar usuario de Auth (Hard delete)
  const user = firebaseAuth?.currentUser;
  if (user && user.uid === tenantId) {
    try {
      await deleteUser(user);
    } catch (error) {
      if (error.code === 'auth/requires-recent-login') {
        throw error;
      }
      // Otros errores de deleteUser no bloquean el flujo de salida
      console.error("Error al eliminar usuario de Auth:", error);
    }
  }

  if (firebaseAuth) await signOut(firebaseAuth);
}

export function listenSales(tenantId, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return () => {};

  const q = query(
    collection(database, 'tenants', tenantId, 'sales'),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const sales = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }));
    callback(sales);
  }, (error) => {
    console.error("Error escuchando ventas:", error);
  });
}

export function listenShifts(tenantId, callback) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return () => {};

  // Escuchamos la colección de turnos
  const q = query(collection(database, 'tenants', tenantId, 'shifts'));

  return onSnapshot(q, (snapshot) => {
    const shifts = snapshot.docs
      .filter(doc => doc.id !== 'state') // Ignorar el doc de estado si existe
      .map(doc => ({
        ...doc.data(),
        id: doc.id
      }));
    callback(shifts);
  }, (error) => {
    console.error("Error escuchando turnos:", error);
  });
}

export async function saveTenantShift(tenantId, shift) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || tenantId === 'demo-commerce') return;
  // NOTA: La validación de límites de plan se realiza en /api/open-shift.
  // No llamar a esta función directamente para aperturas; usar el endpoint del servidor.
  await setDoc(doc(database, 'tenants', tenantId, 'shifts', shift.id), shift);
}

export async function deleteTenantShift(tenantId, shiftId) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !shiftId || tenantId === 'demo-commerce') return;
  await deleteDoc(doc(database, 'tenants', tenantId, 'shifts', shiftId));
}

export async function updateProductStockAtomic(tenantId, productId, quantityChange) {
  const database = getOfflineFirestore();
  if (!database) throw new Error('Firebase no está configurado.');
  if (!tenantId || !productId) throw new Error('Faltan parámetros para actualizar stock.');
  const productRef = doc(database, 'tenants', tenantId, 'products', productId);

  try {
    await updateDoc(productRef, {
      stock: increment(quantityChange),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error en updateProductStockAtomic:", error);
    throw error;
  }
}

/**
 * Procesa una venta completa de forma atómica.
 * Registra la venta y descuenta stock de los items correspondientes.
 * Utiliza writeBatch para mejor rendimiento y soporte offline.
 */
export async function processSaleTransaction(tenantId, sale) {
  const database = getOfflineFirestore();
  if (!database || !tenantId) throw new Error("Database not initialized");

  const batch = writeBatch(database);
  const saleRef = doc(database, 'tenants', tenantId, 'sales', sale.id);

  // 1. Registrar la venta
  batch.set(saleRef, {
    ...sale,
    updatedAt: serverTimestamp()
  });

  // 2. Descontar stock para cada item
  for (const item of sale.items) {
    if (!item.productId) continue;

    if (shouldTrackStock(item)) {
      const productRef = doc(database, 'tenants', tenantId, 'products', item.productId);
      const qty = Number(item.quantity || 0);
      if (qty > 0) {
        batch.update(productRef, {
          stock: increment(-qty),
          updatedAt: serverTimestamp()
        });
      }
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error("Error en processSaleTransaction:", error);
    throw error;
  }
}

/**
 * Actualiza o crea un producto de forma segura para inventario.
 * Utiliza setDoc con increment para permitir funcionamiento offline (las transacciones fallan offline).
 */
export async function updateProductInventoryAtomic(tenantId, scan) {
  const database = getOfflineFirestore();
  if (!database || !tenantId || !scan.barcode) return;

  const productId = String(scan.barcode).trim();
  const productRef = doc(database, 'tenants', tenantId, 'products', productId);

  try {
    const isWeight = scan.isByWeight || false;
    const isSpecial = isSpecialCategory(scan.category);

    // Si es categoría especial y no es pesado, permitimos stock.
    // Si es pesado, permitimos stock decimal a menos que se indique lo contrario.
    const stockChange = Number(scan.stock || 0);

    const data = {
      barcode: scan.barcode,
      name: scan.name,
      price: Number(scan.price),
      category: scan.category || 'General',
      isByWeight: isWeight,
      imageUrl: scan.imageUrl || '',
      updatedAt: serverTimestamp()
    };

    // Ya no forzamos stock null para productos pesables, permitiendo seguimiento decimal.
    // Solo se anula si es categoría especial y no se especificó stock ni trackeo explícito.
    if (isSpecial && !isWeight && !scan.trackStock && (scan.stock === undefined || scan.stock === null)) {
      data.stock = null;
    } else {
      data.stock = increment(stockChange);
    }

    // setDoc con merge: true funciona offline y crea el doc si no existe.
    await setDoc(productRef, data, { merge: true });
  } catch (error) {
    console.error("Error en updateProductInventoryAtomic:", error);
    throw error;
  }
}

export const isFirebaseConfigured = hasFirebaseConfig;

