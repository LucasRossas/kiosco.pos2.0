import React, { useMemo, useState } from 'react';
import { ArrowLeft, Receipt, ShieldCheck, Printer, ExternalLink } from 'lucide-react';
import { getAfipQrUrl } from '../services/arca';
import { toast } from 'sonner';

const paymentLabels = { cash: 'Efectivo', transfer: 'Transferencia', card: 'QR / Tarjeta' };

export default function SalesSummaryScreen({ shift, sales, onBack }) {
  const [selectedSale, setSelectedSale] = useState(null);

  const shiftSales = useMemo(() => {
    return sales
      .filter((sale) => sale.shiftId === shift.id && sale.type !== 'shift-close')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [sales, shift.id]);

  const summary = useMemo(() => {
    const paymentTotals = { cash: 0, transfer: 0, card: 0 };
    const soldProducts = {};

    shiftSales.forEach((sale) => {
      paymentTotals[sale.paymentMethod] = (paymentTotals[sale.paymentMethod] || 0) + sale.total;
      (sale.items || []).forEach((item) => {
        const current = soldProducts[item.productId] || {
          name: item.name,
          quantity: 0,
          isByWeight: item.isByWeight,
          total: 0,
        };
        soldProducts[item.productId] = {
          ...current,
          quantity: current.quantity + item.quantity,
          total: current.total + item.quantity * item.price,
        };
      });
    });

    const total = shiftSales.reduce((sum, sale) => sum + sale.total, 0);
    return {
      total,
      paymentTotals,
      soldProducts: Object.values(soldProducts).sort((a, b) => b.total - a.total),
    };
  }, [shiftSales]);

  return (
    <div className="screen sales-summary-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">VENTAS</p>
          <h2>Resumen del turno</h2>
          <p className="off-hint">Turno {shift.shift} · Cajero: {shift.cashier}</p>
        </div>
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft size={17} /> Volver a cobrar
        </button>
      </div>

      <div className="summary-grid sales-summary-cards">
        <article><span>Monto vendido</span><strong>${summary.total.toFixed(2)}</strong></article>
        <article><span>Ventas realizadas</span><strong>{shiftSales.length}</strong></article>
        <article><span>Ticket promedio</span><strong>${(shiftSales.length ? summary.total / shiftSales.length : 0).toFixed(2)}</strong></article>
      </div>

      <div className="summary-two-columns">
        <section className="summary-panel">
          <div className="summary-panel-heading"><h3>Medios de pago</h3><Receipt size={20} /></div>
          {Object.entries(paymentLabels).map(([method, label]) => (
            <div className="summary-row" key={method}>
              <span>{label}</span><strong>${(summary.paymentTotals[method] || 0).toFixed(2)}</strong>
            </div>
          ))}
        </section>

        <section className="summary-panel">
          <h3>Productos más vendidos</h3>
          {summary.soldProducts.length === 0 ? (
            <p className="off-hint">Todavía no hay ventas registradas en este turno.</p>
          ) : (
            summary.soldProducts.slice(0, 10).map((item) => (
              <div className="summary-row" key={item.name}>
                <span><strong>{item.name}</strong><small>{item.quantity.toFixed(item.isByWeight ? 3 : 0)} {item.isByWeight ? 'kg' : 'un'}</small></span>
                <strong>${item.total.toFixed(2)}</strong>
              </div>
            ))
          )}
        </section>
      </div>

      <div className="summary-panel mt-6">
        <div className="summary-panel-heading">
          <h3>Historial de ventas (Turno actual)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="py-2 px-3 font-semibold">Hora</th>
                <th className="py-2 px-3 font-semibold text-right">Total</th>
                <th className="py-2 px-3 font-semibold">Pago</th>
                <th className="py-2 px-3 font-semibold">Estado</th>
                <th className="py-2 px-3 font-semibold text-center">Factura</th>
              </tr>
            </thead>
            <tbody>
              {shiftSales.map(sale => (
                <tr key={sale.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="py-2 px-3">{new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2 px-3 text-right font-medium">${sale.total.toFixed(2)}</td>
                  <td className="py-2 px-3 text-gray-500">{paymentLabels[sale.paymentMethod] || sale.paymentMethod}</td>
                  <td className="py-2 px-3">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-bold uppercase">Cobrado</span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {sale.invoice?.cae ? (
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1 mx-auto"
                      >
                        <ShieldCheck size={14} />
                        <span className="text-[10px] font-bold">VER CAE</span>
                      </button>
                    ) : (
                      <span className="text-gray-300 text-[10px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSale && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white text-center relative">
              <ShieldCheck size={48} className="mx-auto mb-2 opacity-90" />
              <h3 className="text-xl font-bold">Factura Electrónica</h3>
              <p className="text-blue-100 text-sm">{selectedSale.invoice.type}</p>
              <button
                onClick={() => setSelectedSale(null)}
                className="absolute top-4 right-4 text-white/70 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">CAE</p>
                  <p className="font-mono font-bold text-gray-800">{selectedSale.invoice.cae}</p>
                </div>
                <div>
                  <p className="text-gray-500">Vencimiento</p>
                  <p className="font-bold text-gray-800">{new Date(selectedSale.invoice.vtoCae).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">CUIT Emisor</p>
                  <p className="font-bold text-gray-800">{selectedSale.invoice.cuitEmisor}</p>
                </div>
                <div>
                  <p className="text-gray-500">Punto de Venta</p>
                  <p className="font-bold text-gray-800">{selectedSale.invoice.puntoVenta.toString().padStart(5, '0')}</p>
                </div>
              </div>

              {selectedSale.invoice.isSandbox && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex items-center gap-3 text-amber-800 text-xs">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Factura generada en modo de pruebas (Sandbox). Sin validez fiscal.
                </div>
              )}

              <div className="flex flex-col items-center py-4 border-y border-gray-100 my-4">
                <img
                  src={getAfipQrUrl(selectedSale.invoice)}
                  alt="QR AFIP"
                  className="w-32 h-32 opacity-80"
                />
                <p className="text-[10px] text-gray-400 mt-2 uppercase tracking-widest">Código QR Oficial ARCA/AFIP</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    window.print();
                    toast.info("Función de impresión en desarrollo para tickets térmicos.");
                  }}
                  className="flex-1 bg-gray-800 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors"
                >
                  <Printer size={18} /> Imprimir Ticket
                </button>
                <a
                  href={`https://servicioscf.afip.gob.ar/publico/constancia.aspx`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-12 h-12 border border-gray-200 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink size={20} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
