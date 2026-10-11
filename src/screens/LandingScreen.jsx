import React, { useState } from 'react';
import { ArrowRight, BarChart3, Barcode, Check, ChevronDown, ShieldCheck, Sparkles, Store } from 'lucide-react';
import Footer from '../components/Footer';
import AppScreenshotsCarousel from '../components/AppScreenshotsCarousel';

const plans = [
  {
    id: 'kiosco',
    name: 'Kiosco',
    price: '$9.000',
    description: 'Velocidad y control para tu día a día. Ideal para atención rápida.',
    features: [
      '1 Caja de cobro habilitada.',
      'Venta rápida por unidad y código de barras.',
      'Integración con Mercado Pago y ARCA.',
      'Control de stock y alertas de faltantes.',
      'Resumen de ventas y cierre de turno.',
    ],
  },
  {
    id: 'mercado',
    name: 'Mercado',
    price: '$15.000',
    description: 'Potencia total para minimercados y comercios en crecimiento.',
    features: [
      'Hasta 3 Cajas de cobro en simultáneo.',
      'Venta por peso y granel (Fiambrería/Verdulería).',
      'Productos e inventario ilimitados.',
      'Informes avanzados y multi-turno.',
      'Todo lo incluido en el Plan Kiosco.',
    ],
    featured: true,
  },
];

export default function LandingScreen({ onRegister, onLogin, onNavigateTerms, onNavigatePrivacy }) {
  const [openFaq, setOpenFaq] = useState(null);

  const screenshots = [
    '/screenshots/Screenshot 2026-09-21 204730.png',
    '/screenshots/Screenshot 2026-09-21 204821.png',
    '/screenshots/Screenshot 2026-09-21 204858.png',
    '/screenshots/Screenshot 2026-09-21 205106.png',
    '/screenshots/Screenshot 2026-09-21 205130.png',
  ];

  const faqs = [
    { q: '¿Qué es PuntoGestión?', a: 'Es un sistema de Punto de Venta (POS) en la nube, diseñado específicamente para facilitar la administración diaria de kioscos, minimercados y comercios de cercanía.' },
    { q: '¿Cuánto tiempo toma aprender a usarlo?', a: 'Está diseñado con un enfoque "Zero Training". La interfaz es tan intuitiva que cualquier persona puede empezar a vender y controlar stock en menos de 10 minutos.' },
    { q: '¿Es compatible con factura electrónica?', a: 'Sí, PuntoGestión se integra directamente con ARCA (ex AFIP) para emitir Facturas C de forma legal y rápida con un solo clic desde el sistema.' },
    { q: '¿Qué hardware necesito para empezar?', a: 'Podés usarlo en cualquier PC, notebook o tablet. Para escanear, podés usar un lector de códigos de barras USB convencional o incluso tu celular a través de nuestra terminal móvil.' },
    { q: '¿El sistema funciona si se corta internet?', a: '¡Sí! Contamos con tecnología de sincronización offline. Podés seguir vendiendo y, en cuanto la conexión regrese, los datos se sincronizarán automáticamente con la nube.' },
    { q: '¿Cómo funciona la suscripción?', a: 'Al suscribirte hoy, accedés al plan elegido con un abono mensual fijo. Podés cancelar en cualquier momento desde los ajustes de tu cuenta sin costos adicionales.' },
    { q: '¿Tengo límite de productos o ventas?', a: 'El Plan Kiosco permite hasta 300 productos, mientras que el Plan Mercado es totalmente ilimitado. En ambos planes podés realizar ventas sin restricciones mensuales.' },
    { q: '¿Puedo exportar mi información?', a: 'Absolutamente. Podés descargar reportes de ventas y listados de stock en formato PDF o Excel para tu contabilidad o control personal en cualquier momento.' },
    { q: '¿Cómo recibo las actualizaciones?', a: 'PuntoGestión es una plataforma web moderna, por lo que las actualizaciones de seguridad y nuevas funciones son automáticas y gratuitas. Siempre tendrás la última versión.' },
    { q: '¿Cuentan con soporte técnico?', a: 'Sí, nuestro equipo está disponible para ayudarte vía WhatsApp o email. Además, contamos con una sección de ayuda integrada con tutoriales paso a paso.' },
    { q: '¿Puedo usar varias cajas a la vez?', a: '¡Claro! Con el Plan Mercado podés tener hasta 3 cajas operando en simultáneo, todas sincronizadas en tiempo real con el mismo inventario.' },
    { q: '¿Mis datos están seguros?', a: 'Toda tu información se almacena de forma encriptada en los servidores de Google Cloud. Realizamos copias de seguridad automáticas cada hora para que nunca pierdas nada.' },
    { q: '¿Necesito instalar algo en mi PC?', a: 'No. Al ser una aplicación web moderna, accedés desde el navegador. Esto significa que siempre tenés la versión más reciente sin necesidad de instalaciones complicadas.' },
    { q: '¿Puedo usar una balanza con el sistema?', a: 'Sí. El sistema permite el ingreso manual de peso y es compatible con etiquetas impresas por balanzas comerciales que utilicen el estándar de códigos de barras de peso.' },
    { q: '¿Qué pasa si quiero cambiar de plan?', a: 'Podés subir de plan en cualquier momento desde los ajustes de tu cuenta. El cambio es instantáneo para que no detengas tu operación.' },
  ];

  return (
    <div className="public-page bg-slate-50 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="public-nav bg-white/80 backdrop-blur-md sticky top-0 z-[100] border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-900 font-black text-xl italic tracking-tighter">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white shadow-lg">
            <Store size={20} />
          </div>
          PUNTO<span className="text-blue-600">GESTIÓN</span>
        </div>
        <button className="text-sm font-bold text-slate-600 hover:text-blue-600 transition-colors" onClick={onLogin}>Ingresar</button>
      </header>

      <main>
        {/* Hero */}
        <section className="px-6 py-20 text-center relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-gradient-to-b from-blue-50/50 to-transparent -z-10" />
          <p className="inline-block bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-full mb-6 ring-1 ring-blue-100">
            EL POS QUE TU COMERCIO MERECE
          </p>
          <h1 className="text-5xl lg:text-7xl font-black text-slate-900 leading-[1.1] mb-6 tracking-tight">
            Control total. <br />
            <span className="text-blue-600">Ventas al instante.</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-10 font-medium">
            Gestioná stock, turnos y facturación ARCA sin complicaciones técnicas.
          </p>
          <button
            className="bg-slate-900 text-white px-8 py-4 rounded-full text-lg font-bold shadow-xl hover:-translate-y-1 transition-all flex items-center gap-3 mx-auto"
            onClick={() => document.getElementById('planes')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Ver Planes <ArrowRight size={20} />
          </button>
        </section>

        {/* Product Showcase Carousel */}
        <section className="px-6 py-10 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-1000">
          <div className="text-center mb-4">
            <h2 className="text-2xl md:text-3xl font-black text-slate-900 italic tracking-tight">
              Una interfaz diseñada para la <span className="text-blue-600">velocidad.</span>
            </h2>
          </div>
          <AppScreenshotsCarousel images={screenshots} />
        </section>

        {/* Feature Strip */}
        <section className="px-6 py-12 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { icon: <Barcode />, title: "Escaneo Ágil", desc: "Cámara o lector USB." },
            { icon: <Sparkles />, title: "Auto-Catálogo", desc: "Nombre e imagen auto." },
            { icon: <BarChart3 />, title: "Stock Real", desc: "Alertas de faltantes." },
            { icon: <ShieldCheck />, title: "Cierres Claros", desc: "Cero descuadres." },
          ].map((f, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
              <div className="text-blue-600 mb-4">{f.icon}</div>
              <h3 className="font-bold text-slate-900">{f.title}</h3>
              <p className="text-xs text-slate-500">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* Pricing Section - SENIOR UX REFACTOR */}
        <section id="planes" className="pricing-section py-24 px-6 bg-slate-900 relative overflow-hidden">
          {/* Decoración de fondo */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

          <div className="max-w-6xl mx-auto relative z-10">
            <div className="text-center mb-16">
              <p className="text-blue-400 text-xs font-black uppercase tracking-[0.3em] mb-4">SUSCRIPCIÓN FLEXIBLE</p>
              <h2 className="text-4xl lg:text-5xl font-black text-white leading-tight italic">
                Elegí el plan para tu negocio.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  className={`relative p-8 lg:p-12 rounded-[3rem] border transition-all duration-500 flex flex-col group ${
                    plan.featured
                      ? 'bg-white border-blue-400 shadow-[0_20px_60px_rgba(37,99,235,0.25)] scale-[1.03] z-10'
                      : 'bg-slate-800/40 border-slate-700 text-white hover:border-slate-500'
                  }`}
                >
                  {plan.featured && (
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-black px-6 py-2 rounded-full shadow-lg uppercase tracking-[0.2em]">
                      Más Elegido
                    </div>
                  )}

                  <h3 className={`text-2xl font-black ${plan.featured ? 'text-slate-900' : 'text-white'} mb-3`}>
                    Plan {plan.name}
                  </h3>
                  <p className={`text-sm ${plan.featured ? 'text-slate-500' : 'text-slate-400'} mb-8 leading-relaxed font-medium`}>
                    {plan.description}
                  </p>

                  {/* Jerarquía de Precios Refactorizada */}
                  <div className={`mb-10 p-6 rounded-3xl border ${plan.featured ? 'bg-slate-50 border-slate-100' : 'bg-slate-800/50 border-slate-700/50'}`}>
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-1.5">
                        <strong className={`text-5xl font-black tracking-tighter ${plan.featured ? 'text-blue-600' : 'text-white'}`}>
                          {plan.price}
                        </strong>
                        <span className={`${plan.featured ? 'text-slate-500' : 'text-slate-400'} text-xs font-black uppercase tracking-widest`}>
                          /mes
                        </span>
                      </div>
                    </div>
                  </div>

                  <ul className="space-y-4 mb-12 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm font-medium">
                        <div className="mt-1 bg-emerald-500/20 p-0.5 rounded-full">
                          <Check size={14} className="text-emerald-500" />
                        </div>
                        <span className={plan.featured ? 'text-slate-600' : 'text-slate-300'}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Botón de Acción y Legales */}
                  <div className="space-y-4">
                    <button
                      className={`w-full py-5 rounded-2xl text-lg font-black shadow-xl transition-all hover:-translate-y-1 active:scale-95 ${
                        plan.featured
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'
                          : 'bg-white text-slate-900 hover:bg-slate-100'
                      }`}
                      onClick={() => onRegister(plan.id)}
                    >
                      Suscribirme
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FAQs Simple */}
        <section className="py-20 px-6 max-w-3xl mx-auto">
          <h2 className="text-3xl font-black text-slate-900 text-center mb-12 italic">Preguntas Frecuentes</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <button
                  className="w-full px-6 py-5 flex items-center justify-between font-bold text-slate-800 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q}
                  <ChevronDown size={20} className={`transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <div className="px-6 pb-5 text-sm text-slate-500 leading-relaxed">{faq.a}</div>}
              </div>
            ))}
          </div>
        </section>

      </main>

      <Footer onNavigateTerms={onNavigateTerms} onNavigatePrivacy={onNavigatePrivacy} />
    </div>
  );
}
