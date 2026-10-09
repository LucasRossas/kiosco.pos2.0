import React, { useEffect, useState } from 'react';
import { Store, CreditCard, ArrowLeft, Zap, Headphones } from 'lucide-react';
import { getFirebaseAuth, getOfflineFirestore } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { API_BASE_URL } from '../services/api';

const plans = {
  kiosco: {
    name: 'Kiosco',
    price: 25000,
    fullPriceDisplay: '$50.000',
    priceDisplay: '$25.000',
    description: 'Lo esencial para operar una caja ágil.',
    promoLabel: '50% OFF x 3 Meses'
  },
  mercado: {
    name: 'Mercado',
    price: 42500,
    fullPriceDisplay: '$85.000',
    priceDisplay: '$42.500',
    description: 'La operación completa para comercios que crecen.',
    promoLabel: '50% OFF x 3 Meses'
  }
};

export default function CheckoutScreen({ onBack, onCancelAccount }) {
  const [tenantData, setTenantData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  const auth = getFirebaseAuth();
  const db = getOfflineFirestore();
  const user = auth?.currentUser;

  useEffect(() => {
    async function fetchTenant() {
      if (!user || !db) {
        setLoading(false);
        return;
      }
      try {
        const tenantDoc = await getDoc(doc(db, 'tenants', user.uid));
        if (tenantDoc.exists()) {
          setTenantData(tenantDoc.data());
        } else {
          setError('No se encontró el perfil del comercio.');
        }
      } catch (err) {
        console.error('Error al obtener el tenant:', err);
        setError('Error al cargar la información de suscripción.');
      } finally {
        setLoading(false);
      }
    }
    fetchTenant();
  }, [user, db]);

  const handlePayment = async () => {
    if (!user || !tenantData) return;
    setProcessing(true);
    setError(null);

    const selectedPlanKey = tenantData?.plan || tenantData?.planElegido || 'mercado';
    try {
      // Llamada a la API de Vercel para procesar la suscripción de forma segura
      const token = await user.getIdToken();
      const response = await fetch(`${API_BASE_URL}/api/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planKey: selectedPlanKey
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al conectar con el servidor de pagos');
      }

      if (data.adminBypass) {
        window.location.reload();
      } else if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error('Link de suscripción no generado');
      }
    } catch (err) {
      console.error('Error de suscripción:', err);
      setError(err.message || 'Error al procesar el pago. Por favor intente nuevamente.');
      setProcessing(false);
    }
  };

  if (loading) return <div className="auth-loading"><div className="auth-spinner" /><p>Cargando...</p></div>;

  const selectedPlanKey = tenantData?.plan || tenantData?.planElegido || 'mercado';
  const planInfo = plans[selectedPlanKey] || plans.mercado;
  const planClass = selectedPlanKey === 'mercado' ? 'plan-mercado' : 'plan-kiosco';

  return (
    <div className={`checkout-fullscreen-fixed ${planClass}`}>
      <div className="checkout-side-panel">
        <div className="branding-visual-content">
          <div className="brand-logo-container"><Zap size={40} className="zap-icon" /></div>
          <h2 className="text-white">Potenciá tu negocio</h2>
          <p className="branding-intro text-gray-200">Al activar PuntoGestión, desbloqueás herramientas diseñadas para el crecimiento real.</p>
          <ul className="premium-benefits">
            <li><div className="benefit-icon-box"><Zap size={22} /></div>
              <div className="benefit-text"><strong className="text-white">Operación Ágil</strong><span className="text-gray-200">Ventas más rápidas y control de stock real.</span></div>
            </li>
            <li><div className="benefit-icon-box"><Headphones size={22} /></div>
              <div className="benefit-text"><strong className="text-white">Soporte Prioritario</strong><span className="text-gray-200">Estamos para ayudarte siempre.</span></div>
            </li>
          </ul>
        </div>
      </div>

      <div className="checkout-main-content">
        <div className="checkout-content-wrapper">
          {onBack && <button className="btn-back-login" onClick={onBack}><ArrowLeft size={18} /> Volver</button>}
          <header className="checkout-header-alt">
            <p className="eyebrow">PASO 2 DE 2</p>
            <h1>Activá tu cuenta</h1>
          </header>

          <div className="checkout-details-stack">
            <section className="detail-group">
              <div className="group-label"><Store size={14} /> TU COMERCIO</div>
              <div className="merchant-card-simple">
                <strong>{tenantData?.storeName || 'Mi Comercio'}</strong>
                <span>{tenantData?.email}</span>
              </div>
            </section>

            <section className="detail-group">
              <div className="group-label"><CreditCard size={14} /> PLAN ELEGIDO</div>
              <div className="plan-summary-box relative overflow-hidden">
                <div className="absolute top-2 right-2 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ring-amber-600/20">{planInfo.promoLabel}</div>
                <div className="plan-main-info">
                  <h3>Plan {planInfo.name}</h3>
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-slate-400 line-through leading-none mb-1">{planInfo.fullPriceDisplay}</span>
                    <div className="plan-price-large">{planInfo.priceDisplay}<small>/mes</small></div>
                  </div>
                </div>
              </div>
            </section>

            <section className="checkout-action-area">
              {error && <div className="error-banner">{error}</div>}
              <div className="total-display">
                <span>Total a pagar hoy</span>
                <strong>{planInfo.priceDisplay}</strong>
              </div>
              <button className="btn-pay-mercadopago w-full py-4 text-lg font-bold shadow-lg" onClick={handlePayment} disabled={processing}>
                {processing ? 'Redirigiendo...' : 'Suscribirme con Descuento'}
              </button>

              <button
                onClick={onCancelAccount}
                disabled={processing}
                className="w-full mt-2 py-2 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors bg-transparent border-none cursor-pointer"
              >
                Cancelar y borrar mis datos
              </button>

              <p className="mt-2 text-center text-[10px] text-slate-500">
                Aviso: La suscripción se mantendrá al precio promocional. La actualización a precio regular es manual.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
