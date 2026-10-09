import { useState, useEffect, useMemo } from 'react';
import { getFirebaseAuth } from '../services/firebase';
import { API_BASE_URL } from '../services/api';

export function useNotifications(products, settings, tenantId) {
  const [systemAlerts, setSystemAlerts] = useState([]);
  const [readNotifications, setReadNotifications] = useState(() => {
    const saved = localStorage.getItem(`read_notifications:${tenantId}`);
    return saved ? JSON.parse(saved) : [];
  });

  // 1. Alertas de sistema mediante backend/Admin SDK.
  useEffect(() => {
    let cancelled = false;
    const loadSystemAlerts = async () => {
      const user = getFirebaseAuth()?.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/system-alerts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('No se pudieron cargar las alertas');
        const data = await response.json();
        if (cancelled) return;
        setSystemAlerts(data.active && data.message ? [{
          id: `system-${data.updatedAt?.seconds || data.updatedAt || 'msg'}`,
          type: 'system',
          priority: 1,
          title: 'Aviso del Sistema',
          message: data.message,
          critical: true,
        }] : []);
      } catch (error) {
        console.error('Error cargando alertas del sistema:', error);
      }
    };
    loadSystemAlerts();
    return () => { cancelled = true; };
  }, [tenantId]);

  // 2. Alertas de Stock Bajo
  const stockNotifications = useMemo(() => {
    const threshold = settings.lowStockThreshold ?? 5;
    return products
      .filter(p => !p.isByWeight && p.stock !== null && p.stock <= threshold)
      .map(p => ({
        id: `stock-${p.id}-${p.stock}`,
        type: 'stock',
        priority: 3, // Baja/Media
        title: 'Stock Bajo',
        message: `Stock bajo: Te quedan ${p.stock} unidades de ${p.name}`,
        link: 'stock'
      }));
  }, [products, settings.lowStockThreshold]);

  // 3. Alertas de Suscripción
  const subscriptionNotifications = useMemo(() => {
    if (!settings.activatedAt) return [];

    // Asumimos suscripción mensual de 30 días para el ejemplo
    const activatedDate = new Date(settings.activatedAt);
    const expiryDate = new Date(activatedDate);
    expiryDate.setDate(expiryDate.getDate() + 30);

    const now = new Date();
    const diffTime = expiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 5 && diffDays > 0) {
      return [{
        id: 'subscription-expiry',
        type: 'subscription',
        priority: 2, // Media/Alta
        title: 'Suscripción por vencer',
        message: `Tu suscripción vence en ${diffDays} días. Renueva para no perder acceso`,
        critical: true
      }];
    } else if (diffDays <= 0) {
        return [{
            id: 'subscription-expired',
            type: 'subscription',
            priority: 1,
            title: 'Suscripción vencida',
            message: `Tu plan ${settings.plan} ha vencido. Por favor actualizá tu suscripción.`,
            critical: true
          }];
    }
    return [];
  }, [settings.activatedAt, settings.plan]);

  const allNotifications = useMemo(() => {
    const combined = [...systemAlerts, ...subscriptionNotifications, ...stockNotifications];
    // Filtrar las que ya fueron leídas/descartadas (a menos que sean críticas)
    return combined
      .filter(n => n.critical || !readNotifications.includes(n.id))
      .sort((a, b) => a.priority - b.priority);
  }, [systemAlerts, subscriptionNotifications, stockNotifications, readNotifications]);

  const markAsRead = (id) => {
    if (!id) {
        // Marcar todas como leídas (las no críticas)
        const newRead = [...readNotifications, ...allNotifications.filter(n => !n.critical).map(n => n.id)];
        setReadNotifications(newRead);
        localStorage.setItem(`read_notifications:${tenantId}`, JSON.stringify(newRead));
    } else {
        const newRead = [...readNotifications, id];
        setReadNotifications(newRead);
        localStorage.setItem(`read_notifications:${tenantId}`, JSON.stringify(newRead));
    }
  };

  return {
    notifications: allNotifications,
    markAsRead,
    hasUnread: allNotifications.length > 0
  };
}
