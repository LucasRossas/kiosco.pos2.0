import React from 'react';
import { ArrowRight, BarChart3, BookOpen, Monitor, Package, Settings, ShoppingCart, Store } from 'lucide-react';

const accessCards = [
  {
    id: 'pos',
    title: 'Ventas',
    description: 'Abrí la caja, registrá ventas y consultá el turno activo.',
    icon: ShoppingCart,
    tone: 'teal',
  },
  {
    id: 'products',
    title: 'Productos',
    description: 'Cargá, editá y organizá el catálogo del comercio.',
    icon: Package,
    tone: 'blue',
  },
  {
    id: 'settings',
    title: 'Configuración',
    description: 'Personalizá el comercio y los parámetros operativos.',
    icon: Settings,
    tone: 'slate',
  },
  {
    id: 'daily-summary',
    title: 'Reportes',
    description: 'Consultá balances diarios e historial de turnos.',
    icon: BarChart3,
    tone: 'amber',
  },
  {
    id: 'help',
    title: 'Manual / Ayuda',
    description: 'Guía rápida para ventas, productos y turnos.',
    icon: BookOpen,
    tone: 'slate',
  },
  {
    id: 'open-register',
    title: 'Otro Punto de Venta',
    description: 'Abrí una segunda caja para cobrar en simultáneo.',
    icon: Monitor,
    tone: 'amber',
    mercadoOnly: true,
  },
];

export default function BusinessHomeScreen({ storeName, ownerName, plan, onNavigate, onLogout, theme = 'plan-kiosco' }) {
  const visibleAccessCards = accessCards.filter((card) => !card.mercadoOnly || plan === 'mercado');

  return (
    <div className={`business-home ${theme}`}>
      <header className="business-home-header">
        <div className="public-brand"><Store size={22} /> PuntoGestión</div>
        <div className="business-user">
          <div>
            <strong>{ownerName || 'Dueño del comercio'}</strong>
            <span>Administrador</span>
          </div>
          <button className="btn-ghost" onClick={onLogout}>Salir</button>
        </div>
      </header>

      <main className="business-home-content">
        <section className="business-welcome">
          <div>
            <p className="eyebrow">PANEL PRINCIPAL</p>
            <h1>Hola, {ownerName || 'bienvenido'}.</h1>
            <p>Desde acá podés administrar la operación diaria de <strong>{storeName}</strong>.</p>
          </div>
          <span className="plan-chip">Plan {plan === 'kiosco' ? 'Kiosco' : 'Mercado'}</span>
        </section>

        <section className="access-grid" aria-label="Accesos del comercio">
          {visibleAccessCards.map(({ id, title, description, icon: Icon, tone }) => (
            <button className={`access-card ${tone}`} key={id} onClick={() => onNavigate(id)}>
              <span className="access-icon"><Icon size={24} /></span>
              <span className="access-card-copy"><strong>{title}</strong><span>{description}</span></span>
              <ArrowRight className="access-arrow" size={19} />
            </button>
          ))}
        </section>

        <section className="business-note">
          <strong>Ventas requiere un turno abierto</strong>
          <span>El resto de las herramientas administrativas está disponible para el dueño en todo momento.</span>
        </section>
      </main>
    </div>
  );
}
