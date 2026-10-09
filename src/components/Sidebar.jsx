import React, { useState } from 'react';
import { ShoppingCart, Package, Boxes, Settings, Store, LogOut, Home, ChevronDown, ChevronRight, ClipboardList, LockKeyhole, BarChart3, BookOpen, Menu, X } from 'lucide-react';

const NAV_GROUPS = [
  {
    id: 'sales',
    label: 'Ventas',
    icon: ShoppingCart,
    items: [
      { id: 'pos', label: 'Cobrar', icon: ShoppingCart },
      { id: 'sales-summary', label: 'Resumen de ventas', icon: ClipboardList },
    ],
  },
  {
    id: 'products',
    label: 'Productos',
    icon: Package,
    items: [
      { id: 'products', label: 'Productos', icon: Package },
      { id: 'stock', label: 'Existencias', icon: Boxes },
    ],
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings,
    items: [{ id: 'settings', label: 'Configuración general', icon: Settings }],
  },
  {
    id: 'reports',
    label: 'Reportes',
    icon: BarChart3,
    items: [{ id: 'daily-summary', label: 'Balance e historial', icon: BarChart3 }],
  },
  {
    id: 'help',
    label: 'Manual / Ayuda',
    icon: BookOpen,
    items: [{ id: 'help', label: 'Manual de uso', icon: BookOpen }],
  },
];

export default function Sidebar({ activeView, onNavigate, storeName, onCloseShift, adminUnlocked, salesOnly, productsOnly, settingsOnly, reportsOnly, helpOnly }) {
  const [isOpen, setIsOpen] = useState(false);
  const visibleGroups = salesOnly
    ? NAV_GROUPS.filter((group) => group.id === 'sales')
    : productsOnly
      ? NAV_GROUPS.filter((group) => group.id === 'products')
      : settingsOnly
        ? NAV_GROUPS.filter((group) => group.id === 'settings')
        : reportsOnly
          ? NAV_GROUPS.filter((group) => group.id === 'reports')
          : helpOnly
            ? NAV_GROUPS.filter((group) => group.id === 'help')
      : NAV_GROUPS;
  const activeGroup = visibleGroups.find((group) => group.items.some((item) => item.id === activeView))?.id;

  const navigate = (view) => {
    onNavigate(view);
    setIsOpen(false);
  };

  return (
    <>
      <button className="mobile-menu-button" type="button" onClick={() => setIsOpen((open) => !open)} aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}>
        {isOpen ? <X size={22} /> : <Menu size={22} />}
      </button>
    <nav className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <button className="sidebar-brand-button" onClick={() => navigate('home')} title="Panel principal">
          <Store size={26} />
          <span>{storeName || 'PuntoGestión'}<small className="sidebar-role">Cuenta general</small></span>
        </button>
      </div>
      {salesOnly && <button className="sidebar-item" onClick={() => navigate('home')} title="Ir al panel principal">
        <Home size={20} />
        <span>Panel principal</span>
      </button>}
      {!salesOnly && <button className={`sidebar-item ${activeView === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}>
        <Home size={20} />
        <span>Inicio</span>
      </button>}
      {visibleGroups.map(({ id, label, icon: Icon, items }) => (
        <div className="sidebar-group" key={id}>
          <div className={`sidebar-group-title ${activeGroup === id ? 'expanded' : ''}`}>
            <Icon size={17} />
            <span>{label}</span>
            {activeGroup === id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
          <div className="sidebar-subitems">
            {items.map(({ id: itemId, label: itemLabel, icon: ItemIcon }) => (
              <button
                key={itemId}
                className={`sidebar-item sidebar-subitem ${activeView === itemId ? 'active' : ''} ${id !== 'sales' && !adminUnlocked ? 'locked' : ''}`}
                onClick={() => navigate(itemId)}
              >
                {id !== 'sales' && !adminUnlocked ? <LockKeyhole size={17} /> : <ItemIcon size={17} />}
                <span>{itemLabel}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!productsOnly && !settingsOnly && !reportsOnly && !helpOnly && <button className="sidebar-item sidebar-close" onClick={() => { onCloseShift(); setIsOpen(false); }}>
        <LogOut size={20} />
        <span>Cerrar turno</span>
      </button>}
    </nav>
    </>
  );
}
