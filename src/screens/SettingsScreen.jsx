import React, { useState } from 'react';
import { getFirebaseAuth, updateTenantIntegrations, deleteTenantAccount } from '../services/firebase';
import { CheckCircle, Loader2, Trash2, ShieldAlert, FileText, Smartphone, Zap, Mail, ExternalLink, LogOut, QrCode, MapPin, Printer } from 'lucide-react';
import { changeSubscriptionPlan, cancelSubscription } from '../services/payments';
import { toast } from 'sonner';
import { API_BASE_URL } from '../services/api';
import { ARCA_ENABLED } from '../config/features';

class MpErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, errorInfo) { console.error("MP Error Boundary:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 mt-4">
          <div className="flex items-center gap-3 text-red-700 mb-2">
            <ShieldAlert size={20} />
            <p className="font-black text-sm uppercase text-[10px]">Error de Carga MP</p>
          </div>
          <p className="text-xs text-red-600 mb-4 leading-relaxed font-medium">
            Ocurrió un error inesperado al cargar la configuración.
            Probablemente la API esté devolviendo un formato incompatible.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-white text-red-600 border border-red-200 py-2 rounded-xl text-[10px] font-black hover:bg-red-50 transition-all"
          >
            RECARGAR PANEL
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SettingsScreen({ settings, onSaveSettings, tenantId, onAccountDeleted }) {
  const [form, setForm] = useState(settings);

  // Helper centralizado para MP
  const mpRequest = async (path, options = {}) => {
    const url = `${API_BASE_URL}${path}`;
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Usuario no autenticado');

      const token = await currentUser.getIdToken(true); // Forzar refresh del token

      const res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const contentType = res.headers.get("content-type");
      const isJson = contentType && contentType.includes("application/json");

      if (!isJson) {
        const text = await res.text();
        console.error("URL:", url, "Status:", res.status, "Response:", text.substring(0, 150));
        throw new Error(`Status: ${res.status} | Path: ${path} | Error: Formato no válido`);
      }

      const data = await res.json();
      if (!res.ok) {
        console.error("URL:", url, "Status: ", res.status, "Response:", JSON.stringify(data));
        throw new Error(`Status: ${res.status} | Path: ${path} | Error: ${data.error || 'Desconocido'}`);
      }
      return data;
    } catch (error) {
      if (!error.message.includes(path)) {
        console.error(`MP API Exception [${path}]:`, error);
      }
      throw error;
    }
  };
  const [saved, setSaved] = useState(false);
  const [isSavingIntegrations, setIsSavingIntegrations] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [arcaTestStatus, setArcaTestStatus] = useState('idle');

  // QR Setup State
  const [qrForm, setQrForm] = useState({
    address: '',
    city: '',
    state: 'Capital Federal',
    latitude: '',
    longitude: '',
    storeName: ''
  });
  const [configMode, setConfigMode] = useState(null); // 'auto' | 'map'
  const [stores, setStores] = useState([]);
  const [posList, setPosList] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [selectedPos, setSelectedPos] = useState('');
  const [selectedPosIndex, setSelectedPosIndex] = useState(1);
  const [isLoadingMPData, setIsLoadingMPData] = useState(false);
  const [isSettingUpQR, setIsSettingUpQR] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isConnectingMP, setIsConnectingMP] = useState(false);
  const [isTestingPOS, setIsTestingPOS] = useState(false);

  const handleConnectMP = async () => {
    setIsConnectingMP(true);
    try {
      const data = await mpRequest('/api/mp-auth?action=start');
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No se pudo obtener la URL de conexión');
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsConnectingMP(false);
    }
  };

  const handleDisconnectMP = async () => {
    if (!window.confirm('¿Estás seguro de que querés desconectar Mercado Pago? Esto inhabilitará los cobros con QR.')) return;
    setIsSavingIntegrations(true);
    try {
      await mpRequest('/api/mp-auth?action=disconnect', { method: 'POST' });
      onSaveSettings({
        ...settings,
        mercadoPagoConfig: {
          ...settings.mercadoPagoConfig,
          habilitado: false,
          connected: false,
          userId: null,
          qrImageUrl: null,
          qrConfigs: {}
        }
      });
      toast.success('Mercado Pago desconectado');
    } catch {
      toast.error('Error al desconectar');
    } finally {
      setIsSavingIntegrations(false);
    }
  };

  const handleGetLocation = () => {
    setIsGettingLocation(true);
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización");
      setIsGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setQrForm(prev => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6)
        }));
        setIsGettingLocation(false);
        toast.success("Ubicación obtenida");
      },
      (error) => {
        console.error(error);
        toast.error("Error al obtener ubicación. Asegurate de dar permisos.");
        setIsGettingLocation(false);
      }
    );
  };

  const loadMPStores = async () => {
    setIsLoadingMPData(true);
    try {
      const data = await mpRequest('/api/mp-setup-pos?action=list-stores');
      setStores(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error("No se pudieron cargar las sucursales");
      setStores([]);
      // Si el error es de autenticación o vinculación, podemos resetear el modo
      if (error.message && (error.message.includes("vinculado") || error.message.includes("conectado"))) {
        setConfigMode(null);
      }
    } finally {
      setIsLoadingMPData(false);
    }
  };

  const loadPosList = async (storeId) => {
    setSelectedStore(storeId);
    setSelectedPos('');
    if (!storeId) return setPosList([]);
    setIsLoadingMPData(true);
    try {
      const data = await mpRequest(`/api/mp-setup-pos?action=list-pos&store_id=${storeId}`);
      setPosList(Array.isArray(data) ? data : []);
    } catch {
      toast.error("No se pudieron cargar las cajas");
      setPosList([]);
    } finally {
      setIsLoadingMPData(false);
    }
  };

  const handleSetupQR = async (e) => {
    if (e) e.preventDefault();
    if (isSettingUpQR) return;

    const toastId = toast.loading(configMode === 'map' ? 'Vinculando caja existente...' : 'Configurando nueva sucursal y caja...');
    setIsSettingUpQR(true);

    try {
      const payload = configMode === 'map' ? {
        mode: 'map',
        posData: {
          id: selectedPos,
          store_id: selectedStore
        }
      } : {
        mode: 'create',
        storeData: {
          name: qrForm.storeName || settings.storeName,
          address: qrForm.address,
          city: qrForm.city,
          state: qrForm.state,
          latitude: qrForm.latitude,
          longitude: qrForm.longitude
        },
        posData: {
          name: `Caja ${settings.storeName}`
        }
      };

      const data = await mpRequest('/api/mp-setup-pos?action=setup', {
        method: 'POST',
        body: JSON.stringify({ ...payload, posIndex: selectedPosIndex })
      });

      toast.success('¡Configuración de QR completada!', { id: toastId });

      const backendConfig = {
        posId: data.posId,
        externalPosId: data.externalPosId,
        storeId: data.storeId,
        qrImageUrl: data.qrImageUrl,
        posName: data.posName
      };

      // Nunca escribas campos undefined
      Object.keys(backendConfig).forEach(key => {
        if (backendConfig[key] === undefined) delete backendConfig[key];
      });

      const newQrConfigs = {
        ...(settings.mercadoPagoConfig?.qrConfigs || {}),
        [selectedPosIndex]: backendConfig
      };

      onSaveSettings({
        ...settings,
        mercadoPagoConfig: {
          ...settings.mercadoPagoConfig,
          ...backendConfig,
          qrConfigs: newQrConfigs
        }
      });

    } catch (error) {
      toast.error(error.message, { id: toastId });
    } finally {
      setIsSettingUpQR(false);
    }
  };

  const handleTestPOS = async () => {
    const config = settings.mercadoPagoConfig?.qrConfigs?.[selectedPosIndex];
    const posId = config?.posId;
    if (!posId) return;

    setIsTestingPOS(true);
    const toastId = toast.loading(`Verificando Caja ${selectedPosIndex}...`);

    try {
      const data = await mpRequest(`/api/mp-setup-pos?action=test&pos_id=${posId}`);
      toast.success(`¡Caja "${data.name}" conectada correctamente!`, { id: toastId });
    } catch (error) {
      toast.error(error.message, { id: toastId });
    } finally {
      setIsTestingPOS(false);
    }
  };

  const handlePrintQR = () => {
    document.body.classList.add('printing-poster');

    const afterPrint = () => {
      document.body.classList.remove('printing-poster');
      window.removeEventListener('afterprint', afterPrint);
    };

    window.addEventListener('afterprint', afterPrint);
    window.print();
  };

  const [arcaConfig, setArcaConfig] = useState(settings.arcaConfig || {
    cuit: '',
    condicionIva: 'Monotributo',
    puntoVenta: '',
    habilitado: false,
    sandboxMode: true
  });
  const testARCAConnection = async () => {
    if (!arcaConfig.cuit || !arcaConfig.puntoVenta) {
      toast.error('Completá CUIT y Punto de Venta para probar.');
      return;
    }
    setArcaTestStatus('testing');
    try {
      const { validarCertificados } = await import('../services/arca');
      const result = await validarCertificados({ ...arcaConfig, tenantId });
      if (result?.valid) {
        setArcaTestStatus('success');
      } else {
        setArcaTestStatus('error');
        toast.error('Error de validación: ' + (result?.error || 'Los certificados no son válidos o expiraron.'));
      }
    } catch {
      setArcaTestStatus('error');
      toast.error('Error al conectar con el servidor de validación.');
    } finally {
      setTimeout(() => setArcaTestStatus('idle'), 4000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const adminPasswordEnabled = Boolean(form.adminPasswordEnabled);
    let ownerPasswordRecord = settings.ownerPasswordRecord;

    if (adminPasswordEnabled) {
      if (form.ownerPassword && form.ownerPassword.length >= 6) {
        const { hashPassword } = await import('../utils/passwordHash');
        ownerPasswordRecord = await hashPassword(form.ownerPassword);
      } else if (!ownerPasswordRecord) {
        toast.error('La clave debe tener al menos 6 caracteres');
        return;
      }
    }

    onSaveSettings({
      ...settings,
      storeName: form.storeName.trim(),
      scalePrefix: form.scalePrefix.trim() || '2',
      scaleFormat: form.scaleFormat || 'weight',
      lowStockThreshold: Math.max(parseInt(form.lowStockThreshold, 10) || 0, 0),
      ticketFooter: form.ticketFooter.trim(),
      invoiceFormat: form.invoiceFormat,
      ownerPasswordRecord: adminPasswordEnabled ? ownerPasswordRecord : null,
      adminPasswordEnabled,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSaveIntegrations = async () => {
    if (!tenantId || tenantId === 'demo-commerce') {
      toast.error('Debes iniciar sesión para configurar integraciones');
      return;
    }
    setIsSavingIntegrations(true);
    try {
      const integrationsUpdate = {
        mercadoPagoConfig: {
          ...settings.mercadoPagoConfig,
          habilitado: settings.mercadoPagoConfig?.habilitado || false,
          userId: settings.mercadoPagoConfig?.userId || null,
          vinculadoAt: settings.mercadoPagoConfig?.vinculadoAt || null
        },
        arcaConfig: {
          ...arcaConfig,
          habilitado: Boolean(arcaConfig.cuit && arcaConfig.puntoVenta)
        }
      };

      await updateTenantIntegrations(tenantId, integrationsUpdate);
      onSaveSettings({ ...settings, ...integrationsUpdate });
      toast.success('Integraciones guardadas correctamente');
    } catch (error) {
      console.error(error);
      toast.error('Error al guardar integraciones: ' + error.message);
    } finally {
      setIsSavingIntegrations(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'ELIMINAR') return;
    setIsDeleting(true);

    try {
      // 1. Manejo de cuenta Demo (no requiere flujo de MP)
      if (!tenantId || tenantId === 'demo-commerce') {
        localStorage.clear();
        toast.success('Cuenta Demo reiniciada correctamente.');
        if (onAccountDeleted) onAccountDeleted();
        return;
      }

      // 2. Cancelar suscripción en Mercado Pago si existe subscriptionId
      if (settings.subscriptionId) {
        try {
          await cancelSubscription(settings.subscriptionId);
          console.log("Suscripción de Mercado Pago cancelada satisfactoriamente.");
        } catch (mpError) {
          console.error("Error al cancelar en MP:", mpError);
          throw new Error(
            "No pudimos cancelar tu cobro automático en Mercado Pago. " +
            "Por seguridad, la cuenta no se eliminará hasta que el cobro sea cancelado. " +
            "Por favor, intentá de nuevo o contactanos si el problema persiste.",
            { cause: mpError }
          );
        }
      }

      // 3. Proceder al borrado de datos en Firestore y Auth
      await deleteTenantAccount(tenantId);

      toast.success('Tu suscripción fue cancelada y tu cuenta ha sido eliminada correctamente.');
      if (onAccountDeleted) onAccountDeleted();
    } catch (error) {
      console.error("Error en proceso de eliminación:", error);
      if (error.code === 'auth/requires-recent-login') {
        toast.error('Por razones de seguridad, necesitás volver a iniciar sesión antes de eliminar tu cuenta definitivamente.');
      } else {
        toast.error(error.message || 'Error al eliminar la cuenta');
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handlePlanChange = async (targetPlan) => {
    if (!window.confirm(`¿Confirmás el cambio al Plan ${targetPlan.toUpperCase()}?`)) return;

    setIsChangingPlan(true);
    try {
      const result = await changeSubscriptionPlan(
        tenantId,
        settings.plan,
        targetPlan,
        settings.subscriptionId
      );

      if (result.isUpgrade) {
        toast.success("¡Upgrade exitoso! Ya podés usar las funciones del Plan Mercado.");
        onSaveSettings({ ...settings, plan: 'mercado', scheduledDowngrade: null, downgradeDate: null });
      } else {
        toast.info(`Downgrade programado. Seguirás en Plan Mercado hasta el ${new Date(result.downgradeDate).toLocaleDateString()}.`);
        onSaveSettings({ ...settings, scheduledDowngrade: 'kiosco', downgradeDate: result.downgradeDate });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsChangingPlan(false);
    }
  };

  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">CONFIGURACIÓN</p>
          <h2>Panel de Control</h2>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card subscription-card">
          <h3 className="flex items-center gap-2">
            <Zap className="text-blue-600" size={20} /> Mi Suscripción
          </h3>
          <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 mt-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Plan Actual</p>
                <p className="text-2xl font-black text-slate-900">Plan {settings.plan?.toUpperCase() || 'KIOSCO'}</p>
                {settings.scheduledDowngrade && (
                  <span className="text-xs text-amber-600 font-bold block mt-1">
                    ⚠️ Downgrade a Kiosco programado para el {new Date(settings.downgradeDate).toLocaleDateString()}
                  </span>
                )}
              </div>

              <button
                disabled={isChangingPlan || !settings.subscriptionId}
                onClick={() => handlePlanChange(settings.plan === 'kiosco' ? 'mercado' : 'kiosco')}
                className={`px-6 py-3 rounded-2xl font-black text-sm transition-all shadow-lg active:scale-95 disabled:opacity-50 ${
                  settings.plan === 'kiosco'
                    ? 'bg-blue-600 text-white shadow-blue-200 hover:bg-blue-700'
                    : 'bg-white text-slate-900 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {isChangingPlan ? (
                  <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Procesando...</span>
                ) : (
                  settings.plan === 'kiosco' ? 'Pasar a Plan Mercado' : 'Bajar a Plan Kiosco'
                )}
              </button>
            </div>
            {!settings.subscriptionId && (
              <p className="text-[10px] text-slate-500 mt-4 italic">
                * Las funciones de suscripción requieren una suscripción activa vía Mercado Pago.
              </p>
            )}
          </div>
        </section>

        <section className="settings-card">
          <h3>General</h3>
          <form className="settings-form" onSubmit={handleSubmit}>
            <label>
              Nombre del comercio
              <input
                type="text"
                value={form.storeName}
                onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                required
              />
            </label>

            <div className="form-row">
              <label>
                Prefijo balanza
                <input
                  type="text"
                  value={form.scalePrefix}
                  onChange={(e) => setForm({ ...form, scalePrefix: e.target.value })}
                  maxLength={2}
                  required
                />
              </label>
              <label>
                Formato de balanza
                <select
                  value={form.scaleFormat || 'weight'}
                  onChange={(e) => setForm({ ...form, scaleFormat: e.target.value })}
                >
                  <option value="weight">El código incluye el Peso (Ej: PP IIII PPPPP C)</option>
                  <option value="price">El código incluye el Precio Total (Ej: PP IIII $$$$$ C)</option>
                </select>
              </label>
              <label>
                Stock bajo
                <input
                  type="number"
                  min="0"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  required
                />
              </label>
            </div>

            <label>
              Mensaje del ticket
              <input
                type="text"
                value={form.ticketFooter}
                onChange={(e) => setForm({ ...form, ticketFooter: e.target.value })}
              />
            </label>

            <label>
              Formato de PDF predeterminado
              <select
                value={form.invoiceFormat || 'A4'}
                onChange={(e) => setForm({ ...form, invoiceFormat: e.target.value })}
              >
                <option value="A4">Hoja A4 (Factura)</option>
                <option value="Ticket">Ticket (80mm)</option>
              </select>
            </label>

            <div className="admin-password-settings">
              <label className="checkbox-field">
                <span>Activar clave de administrador</span>
                <input
                  type="checkbox"
                  checked={Boolean(form.adminPasswordEnabled)}
                  onChange={(e) => setForm({ ...form, adminPasswordEnabled: e.target.checked })}
                />
              </label>
              {form.adminPasswordEnabled && <label>
                Clave de administrador
                <input
                  type="password"
                  minLength="6"
                  required
                  value={form.ownerPassword || ''}
                  onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                />
              </label>}
            </div>

            <button type="submit" className="btn-primary">Guardar General</button>
            {saved && <p className="settings-saved">✓ Guardado</p>}
          </form>
        </section>

        <div className="integrations-column">
          <section className="settings-card">
            <h3><Smartphone size={18} /> Mercado Pago (Checkout)</h3>
            <div className="settings-form">
              {settings.mercadoPagoConfig?.habilitado ? (
                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 mb-4">
                  <div className="flex items-center gap-3 text-emerald-700 mb-3">
                    <CheckCircle size={24} />
                    <span className="text-lg font-black tracking-tight">Cuenta Conectada</span>
                  </div>
                  <p className="text-xs text-emerald-600 mb-4 leading-relaxed font-medium">
                    Tu cuenta de Mercado Pago está vinculada correctamente y lista para procesar cobros automáticos.
                  </p>
                  <div className="flex flex-col gap-3">
                    <div className="bg-white/50 p-2 rounded-lg border border-emerald-200/50">
                      <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">
                        Vendedor Vinculado (MP ID)
                      </p>
                      <p className="text-sm font-black text-emerald-700 mt-0.5">
                        {settings.mercadoPagoConfig?.userId || 'ID No disponible'}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleDisconnectMP}
                        disabled={isSavingIntegrations}
                        className="flex-1 bg-white text-red-600 border border-red-200 hover:bg-red-50 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center justify-center gap-2 shadow-sm"
                      >
                        {isSavingIntegrations ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                        Desconectar
                      </button>
                      <button
                        onClick={handleConnectMP}
                        className="flex-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95"
                      >
                        Cambiar Cuenta
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 mb-4">
                  <p className="text-sm text-blue-700 font-medium mb-3">
                    Conectá tu cuenta para habilitar pagos con QR y links de pago.
                  </p>
                  <button
                    className="w-full bg-[#009ee3] hover:bg-[#008ac9] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg disabled:opacity-50"
                    onClick={handleConnectMP}
                    disabled={isConnectingMP}
                  >
                    {isConnectingMP ? (
                      <><Loader2 size={18} className="animate-spin" /> Conectando...</>
                    ) : (
                      <><ExternalLink size={18} /> Conectar Mercado Pago</>
                    )}
                  </button>
                </div>
              )}

              <p className="text-xs text-slate-500">La credencial privada se administra exclusivamente en el servidor (Heroku).</p>
            </div>
          </section>

          {settings.mercadoPagoConfig?.habilitado && (
            <MpErrorBoundary>
              <section className="settings-card qr-config-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="flex items-center gap-2 m-0">
                  <QrCode size={18} className="text-emerald-600" /> Cobro con QR Interoperable
                </h3>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${settings.plan === 'mercado' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  PLAN {settings.plan?.toUpperCase() || 'KIOSCO'} ({settings.plan === 'mercado' ? 'Hasta 3 cajas' : '1 caja'})
                </span>
              </div>

              {/* Selector de Caja */}
              <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl">
                {[1, 2, 3].map(idx => {
                  const isMercado = settings.plan === 'mercado';
                  if (!isMercado && idx > 1) return null;
                  const isConfigured = !!settings.mercadoPagoConfig?.qrConfigs?.[idx]?.qrImageUrl;

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedPosIndex(idx);
                        setConfigMode(null);
                      }}
                      className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 ${
                        selectedPosIndex === idx
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      CAJA {idx}
                      {isConfigured && <CheckCircle size={10} className="text-emerald-500" />}
                    </button>
                  );
                })}
              </div>

              {!settings.mercadoPagoConfig?.qrConfigs?.[selectedPosIndex]?.qrImageUrl ? (
                <div className="mt-4">
                  {!configMode ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-slate-600 mb-2 font-medium">
                        Elegí cómo querés configurar tu cobro con QR V2:
                      </p>

                      <button
                        onClick={() => setConfigMode('auto')}
                        className="w-full bg-emerald-50 text-emerald-700 p-5 rounded-[1.5rem] border border-emerald-100 text-left hover:bg-emerald-100 transition-all group relative overflow-hidden"
                      >
                        <div className="relative z-10">
                          <p className="font-black text-xs uppercase tracking-wider mb-1">Camino A: Configuración Automática</p>
                          <p className="text-[11px] opacity-80 font-bold leading-tight">Creamos una sucursal y caja nueva por vos con IDs predecibles.</p>
                        </div>
                        <Zap size={40} className="absolute -right-2 -bottom-2 text-emerald-200/50 group-hover:scale-110 transition-transform" />
                      </button>

                      <button
                        onClick={() => {
                          setConfigMode('map');
                          loadMPStores();
                        }}
                        className="w-full bg-blue-50 text-blue-700 p-5 rounded-[1.5rem] border border-blue-100 text-left hover:bg-blue-100 transition-all group relative overflow-hidden"
                      >
                        <div className="relative z-10">
                          <p className="font-black text-xs uppercase tracking-wider mb-1">Camino B: Vincular Existente</p>
                          <p className="text-[11px] opacity-80 font-bold leading-tight">Mapeá una sucursal y caja que ya tengas creada en Mercado Pago.</p>
                        </div>
                        <MapPin size={40} className="absolute -right-2 -bottom-2 text-blue-200/50 group-hover:scale-110 transition-transform" />
                      </button>

                      <p className="text-[10px] text-slate-400 italic text-center mt-2">
                        * Mercado Pago V2 requiere que el POS esté asociado a una sucursal física válida.
                      </p>
                    </div>
                  ) : configMode === 'auto' ? (
                    <form onSubmit={handleSetupQR} className="settings-form space-y-4">
                      <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50 mb-2">
                        <p className="text-[11px] text-emerald-700 font-bold">
                          Configurando nueva sucursal y caja. Por favor, completá los datos de ubicación.
                        </p>
                      </div>

                      <label className="block text-xs font-bold text-slate-500 uppercase">
                        Dirección del Local
                        <div className="relative mt-1">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input
                            type="text"
                            className="pl-10 w-full"
                            placeholder="Ej: Av. Rivadavia 1234"
                            value={qrForm.address}
                            onChange={e => setQrForm({...qrForm, address: e.target.value})}
                            required
                          />
                        </div>
                      </label>

                      <div className="grid grid-cols-2 gap-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase">
                          Ciudad
                          <input
                            type="text"
                            className="mt-1 w-full"
                            placeholder="Ej: CABA"
                            value={qrForm.city}
                            onChange={e => setQrForm({...qrForm, city: e.target.value})}
                            required
                          />
                        </label>
                        <label className="block text-xs font-bold text-slate-500 uppercase">
                          Provincia
                          <select
                            className="mt-1 w-full"
                            value={qrForm.state}
                            onChange={e => setQrForm({...qrForm, state: e.target.value})}
                            required
                          >
                            <option value="Capital Federal">Capital Federal</option>
                            <option value="Buenos Aires">Buenos Aires</option>
                            <option value="Catamarca">Catamarca</option>
                            <option value="Chaco">Chaco</option>
                            <option value="Chubut">Chubut</option>
                            <option value="Cordoba">Córdoba</option>
                            <option value="Corrientes">Corrientes</option>
                            <option value="Entre Rios">Entre Ríos</option>
                            <option value="Formosa">Formosa</option>
                            <option value="Jujuy">Jujuy</option>
                            <option value="La Pampa">La Pampa</option>
                            <option value="La Rioja">La Rioja</option>
                            <option value="Mendoza">Mendoza</option>
                            <option value="Misiones">Misiones</option>
                            <option value="Neuquen">Neuquén</option>
                            <option value="Rio Negro">Río Negro</option>
                            <option value="Salta">Salta</option>
                            <option value="San Juan">San Juan</option>
                            <option value="San Luis">San Luis</option>
                            <option value="Santa Cruz">Santa Cruz</option>
                            <option value="Santa Fe">Santa Fe</option>
                            <option value="Santiago del Estero">Santiago del Estero</option>
                            <option value="Tierra del Fuego">Tierra del Fuego</option>
                            <option value="Tucuman">Tucumán</option>
                          </select>
                        </label>
                      </div>

                      <div className="location-coords-box bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-black text-slate-500 uppercase">Coordenadas (Recomendado)</span>
                          <button
                            type="button"
                            onClick={handleGetLocation}
                            disabled={isGettingLocation}
                            className="text-[10px] bg-white text-blue-600 px-2 py-1 rounded-md font-bold border border-blue-100 hover:bg-blue-50 transition-colors flex items-center gap-1"
                          >
                            {isGettingLocation ? <Loader2 size={10} className="animate-spin" /> : <MapPin size={10} />}
                            Obtener actual
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="text-xs py-2"
                            placeholder="Latitud"
                            value={qrForm.latitude}
                            onChange={e => setQrForm({...qrForm, latitude: e.target.value.replace(/[^0-9.-]/g, '')})}
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            className="text-xs py-2"
                            placeholder="Longitud"
                            value={qrForm.longitude}
                            onChange={e => setQrForm({...qrForm, longitude: e.target.value.replace(/[^0-9.-]/g, '')})}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setConfigMode(null)}
                          className="flex-1 bg-white text-slate-500 border border-slate-200 py-3 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all"
                        >
                          Volver
                        </button>
                        <button
                          type="submit"
                          disabled={isSettingUpQR}
                          className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-100"
                        >
                          {isSettingUpQR ? <Loader2 size={18} className="animate-spin" /> : 'Generar QR Oficial'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="settings-form space-y-4">
                      <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50 mb-2">
                        <p className="text-[11px] text-blue-700 font-bold">
                          Seleccioná una sucursal y caja existente de tu cuenta de Mercado Pago.
                        </p>
                      </div>

                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase m-0">
                          Seleccionar Sucursal
                        </label>
                        <button
                          type="button"
                          onClick={loadMPStores}
                          disabled={isLoadingMPData}
                          className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1"
                        >
                          {isLoadingMPData ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                          Actualizar lista
                        </button>
                      </div>

                      <select
                        className="mt-1 w-full"
                        value={selectedStore}
                        onChange={e => loadPosList(e.target.value)}
                        required
                      >
                        <option value="">{(isLoadingMPData && (!stores || stores.length === 0)) ? 'Cargando sucursales...' : 'Seleccionar...'}</option>
                        {Array.isArray(stores) && stores.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.external_id ? `(${s.external_id})` : ''}
                          </option>
                        ))}
                      </select>

                      {selectedStore && (
                        <label className="block text-xs font-bold text-slate-500 uppercase">
                          Seleccionar Caja (POS)
                          {isLoadingMPData && posList.length === 0 && <Loader2 size={12} className="animate-spin inline ml-2" />}
                          <select
                            className="mt-1 w-full"
                            value={selectedPos}
                            onChange={e => setSelectedPos(e.target.value)}
                            required
                          >
                            <option value="">{(isLoadingMPData && (!posList || posList.length === 0)) ? 'Cargando cajas...' : 'Seleccionar...'}</option>
                            {Array.isArray(posList) && posList.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.external_id ? `(${p.external_id})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setConfigMode(null)}
                          className="flex-1 bg-white text-slate-500 border border-slate-200 py-3 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all"
                        >
                          Volver
                        </button>
                        <button
                          onClick={() => handleSetupQR()}
                          disabled={isSettingUpQR || !selectedPos}
                          className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100"
                        >
                          {isSettingUpQR ? <Loader2 size={18} className="animate-spin" /> : 'Vincular Caja Existente'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="qr-preview-container bg-white p-6 rounded-[2rem] border-2 border-dashed border-emerald-200 flex flex-col items-center">
                    <img
                      src={settings.mercadoPagoConfig.qrConfigs[selectedPosIndex].qrImageUrl}
                      alt="QR Mercado Pago"
                      className="w-48 h-48 object-contain mb-4"
                    />
                    <div className="text-center">
                      <p className="text-sm font-black text-slate-800 uppercase tracking-tighter">
                        {settings.mercadoPagoConfig.qrConfigs[selectedPosIndex].posName || `Caja ${selectedPosIndex}`} Habilitada
                      </p>
                      <p className="text-[10px] text-emerald-600 font-bold">{settings.storeName || 'Mi Comercio'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handlePrintQR}
                      className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-100"
                    >
                      <Printer size={14} /> Imprimir Poster QR
                    </button>
                    <button
                      onClick={handleTestPOS}
                      disabled={isTestingPOS}
                      className="flex-1 bg-white text-blue-600 border border-blue-200 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 hover:bg-blue-50 transition-all active:scale-95"
                    >
                      {isTestingPOS ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                      Probar Conexión
                    </button>
                    <button
                      onClick={() => {
                        const newConfigs = { ...settings.mercadoPagoConfig.qrConfigs };
                        delete newConfigs[selectedPosIndex];
                        onSaveSettings({
                          ...settings,
                          mercadoPagoConfig: {
                            ...settings.mercadoPagoConfig,
                            qrImageUrl: null,
                            qrConfigs: newConfigs
                          }
                        });
                      }}
                      className="px-4 bg-white text-slate-400 border border-slate-200 rounded-xl text-xs font-bold hover:text-red-500 hover:border-red-200 transition-all"
                      title="Reconfigurar"
                    >
                      Re-configurar
                    </button>
                  </div>

                  <div className="print-only-poster hidden">
                    {/* Este div solo se verá al imprimir */}
                    <div className="print-poster-content">
                       <div className="poster-header">
                          <h1>Pagá con QR</h1>
                          <p>Escaneá con cualquier billetera virtual</p>
                       </div>
                       <div className="poster-qr-wrapper">
                          <img src={settings.mercadoPagoConfig.qrConfigs[selectedPosIndex].qrImageUrl} alt="QR" />
                       </div>
                       <div className="poster-footer">
                          <h2>{settings.storeName}</h2>
                          <div className="poster-badges">
                             <div className="poster-badge">Interoperable</div>
                             <div className="poster-badge">Mercado Pago</div>
                          </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
            </MpErrorBoundary>
          )}

          {ARCA_ENABLED && (
            <section className="settings-card">
              <h3><FileText size={18} /> ARCA (Facturación)</h3>
              <div className="settings-form">
                <div className="form-row triplet">
                  <label>
                    CUIT
                    <input
                      type="number"
                      value={arcaConfig.cuit}
                      onChange={(e) => setArcaConfig({ ...arcaConfig, cuit: e.target.value })}
                    />
                  </label>
                  <label>
                    Punto Venta
                    <input
                      type="number"
                      value={arcaConfig.puntoVenta}
                      onChange={(e) => setArcaConfig({ ...arcaConfig, puntoVenta: e.target.value })}
                    />
                  </label>
                </div>

                <p className="text-xs text-slate-500">Los certificados ARCA no se suben a Firebase. Deben configurarse como secretos privados en el servidor (Heroku).</p>

                <div style={{ margin: '10px 0' }}>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={!!arcaConfig.sandboxMode}
                      onChange={(e) => setArcaConfig({ ...arcaConfig, sandboxMode: e.target.checked })}
                    />
                    <span>Habilitar Modo Sandbox (Pruebas)</span>
                  </label>
                  {arcaConfig.sandboxMode && (
                    <p className="text-[10px] text-amber-600 font-bold mt-1">
                      ⚠️ Los comprobantes emitidos en este modo NO TIENEN VALIDEZ LEGAL.
                    </p>
                  )}
                </div>

                {arcaTestStatus !== 'idle' && (
                  <div className={`connection-status ${arcaTestStatus}`}>
                    {arcaTestStatus === 'testing' && <><Loader2 size={16} className="spin" /> Verificando con ARCA...</>}
                    {arcaTestStatus === 'success' && <><CheckCircle size={16} /> Certificados válidos</>}
                  </div>
                )}

                <div className="actions-row">
                  <button className="btn-secondary" onClick={testARCAConnection} disabled={arcaTestStatus === 'testing'}>Probar</button>
                  <button
                    className="btn-primary"
                    onClick={handleSaveIntegrations}
                    disabled={isSavingIntegrations}
                  >
                    {isSavingIntegrations ? 'Guardando...' : 'Guardar Integraciones'}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        <section className="settings-card bg-slate-50 border-blue-100">
          <h3 className="flex items-center gap-2 text-blue-600"><Mail size={18} /> ¿Necesitás ayuda técnica?</h3>
          <p className="text-sm text-slate-600 mt-2 mb-4">Nuestro equipo de soporte está disponible para asistirte con la configuración, problemas técnicos o dudas sobre el sistema.</p>
          <div className="flex flex-col sm:flex-row gap-3">
             <a
              href={`https://mail.google.com/mail/?view=cm&fs=1&to=lr.development.code@gmail.com&su=${encodeURIComponent("Soporte Técnico - PuntoGestión")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl transition-all text-xs shadow-md active:scale-95"
            >
              <ExternalLink size={14} /> Contactar por Email
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText("lr.development.code@gmail.com");
                toast.success("Email copiado al portapapeles");
              }}
              className="flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 py-2.5 px-4 rounded-xl text-xs font-bold transition-all"
            >
              Copiar dirección
            </button>
          </div>
        </section>

        <section className="settings-card danger-zone">
          <h3><ShieldAlert size={20} /> Zona Peligrosa</h3>
          <p>La eliminación de la cuenta es irreversible. Se borrarán todos tus productos, ventas y configuraciones.</p>
          <button className="btn-danger" onClick={() => { setDeleteInput(''); setShowDeleteModal(true); }}>
            <Trash2 size={18} /> Eliminar Cuenta Definitivamente
          </button>
        </section>
      </div>

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-content delete-confirm-modal">
            <div className="modal-heading">
              <h3>¿Confirmás la eliminación?</h3>
            </div>
            <div className="delete-warning-box">
              <strong>CUIDADO:</strong> Estás por borrar toda la información de tu comercio. Esta acción no se puede deshacer.
            </div>
            <p style={{ fontSize: '14px', color: '#4b5563', marginBottom: '12px' }}>
              Escribí <strong>ELIMINAR</strong> para confirmar:
            </p>
            <input
              type="text"
              className="stock-input"
              style={{ width: '100%', marginBottom: '20px' }}
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="ELIMINAR"
            />
            <div className="delete-actions">
              <button
                className="btn-danger"
                disabled={deleteInput !== 'ELIMINAR' || isDeleting}
                onClick={handleDeleteAccount}
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar todo definitivamente'}
              </button>
              <button className="btn-secondary" disabled={isDeleting} onClick={() => setShowDeleteModal(false)}>
                Me arrepentí, volver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
