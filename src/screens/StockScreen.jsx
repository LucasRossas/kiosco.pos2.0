import React, { useState } from 'react';
import { Search, AlertTriangle } from 'lucide-react';

export default function StockScreen({ products, settings, onUpdateStock }) {
  const [query, setQuery] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const threshold = settings.lowStockThreshold ?? 5;

  const statusOf = (p) => {
    const s = p.stock ?? 0;
    if (s <= 0) return 'out';
    if (s <= threshold) return 'low';
    return 'ok';
  };

  const filtered = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        (p.barcode || '').toLowerCase().includes(query.toLowerCase()) ||
        (p.shortReference || '').toLowerCase().includes(query.toLowerCase())
    )
    .filter((p) => !onlyLow || statusOf(p) !== 'ok');

  const lowCount = products.filter((p) => statusOf(p) !== 'ok').length;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Control de Stock</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lowCount > 0 && (
            <span className="low-stock-alert">
              <AlertTriangle size={16} /> {lowCount} producto(s) con stock bajo o agotado
            </span>
          )}
          <div className="search-inline">
            <Search size={18} color="#6b7280" />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={onlyLow}
              onChange={(e) => setOnlyLow(e.target.checked)}
            />
            Solo bajo stock
          </label>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Código</th>
            <th>Tipo</th>
            <th style={{ width: 160 }}>Stock actual</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
                {onlyLow ? 'No hay productos con stock bajo. ¡Bien!' : 'Sin resultados.'}
              </td>
            </tr>
          ) : (
            filtered.map((p) => {
              const status = statusOf(p);
              return (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.barcode || `Ref. ${p.shortReference}`}</td>
                  <td>{p.isByWeight ? 'Por peso (kg)' : 'Unidad'}</td>
                  <td>
                    <input
                      type="number"
                      className="stock-input"
                      min="0"
                      step={p.isByWeight ? '0.001' : '1'}
                      value={p.stock}
                      onChange={(e) =>
                        onUpdateStock(p.id, Math.max(parseFloat(e.target.value) || 0, 0))
                      }
                    />
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {p.isByWeight ? ' kg' : ' u'}
                    </span>
                  </td>
                  <td>
                    <span className={`stock-badge ${status}`}>
                      {status === 'out' ? 'Agotado' : status === 'low' ? 'Bajo' : 'OK'}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
