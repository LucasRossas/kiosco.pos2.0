import React, { useState, useRef, useEffect } from 'react';
import { Bell, X, Package, CreditCard, AlertTriangle, Info } from 'lucide-react';

export default function NotificationBell({ notifications, onMarkAsRead, onNavigate }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const unreadCount = notifications.length;

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  const getIcon = (type) => {
    switch (type) {
      case 'stock': return <Package size={18} className="text-amber-500" />;
      case 'subscription': return <CreditCard size={18} className="text-blue-500" />;
      case 'system': return <AlertTriangle size={18} className="text-red-500" />;
      default: return <Info size={18} className="text-gray-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
        aria-label="Notificaciones"
      >
        <Bell size={24} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? '+9' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
          <div className="p-4 border-b flex justify-between items-center bg-gray-50/50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              Notificaciones
              {unreadCount > 0 && <span className="text-xs font-normal text-gray-500">({unreadCount} pendientes)</span>}
            </h3>
            <div className="flex gap-2">
                {unreadCount > 0 && (
                    <button
                        onClick={() => onMarkAsRead()}
                        className="text-[11px] font-semibold text-blue-600 hover:underline"
                    >
                        Limpiar todo
                    </button>
                )}
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={18} />
                </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center gap-3">
                <div className="bg-gray-50 p-4 rounded-full">
                    <Bell size={32} className="text-gray-300" />
                </div>
                <p className="text-gray-500 text-sm">No tenés notificaciones pendientes.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 ${n.critical ? 'bg-red-50/30' : ''}`}
                    onClick={() => {
                        if (n.link) onNavigate(n.link);
                        setIsOpen(false);
                    }}
                  >
                    <div className={`flex-none mt-1 p-2 rounded-lg ${
                        n.type === 'system' ? 'bg-red-100' :
                        n.type === 'subscription' ? 'bg-blue-100' : 'bg-amber-100'
                    }`}>
                        {getIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className={`text-sm font-bold ${n.critical ? 'text-red-900' : 'text-gray-800'}`}>
                            {n.title}
                        </p>
                        {!n.critical && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMarkAsRead(n.id);
                                }}
                                className="text-gray-300 hover:text-gray-500"
                            >
                                <X size={14} />
                            </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        {n.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
              <div className="p-3 bg-gray-50 border-t text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                      PuntoGestión Alertas
                  </p>
              </div>
          )}
        </div>
      )}
    </div>
  );
}
