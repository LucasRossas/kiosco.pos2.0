import React, { useMemo, useState } from 'react';
import { ArrowLeft, Banknote, CheckCircle2 } from 'lucide-react';

const paymentLabels = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  qr_mp: 'QR Mercado Pago',
  other: 'Otros'
};

export default function ShiftCloseScreen({ shift, sales, onCloseShift, onBack }) {
  const [cashActual, setCashActual] = useState('');
  const [notes, setNotes] = useState('');
  const shiftSales = sales.filter((sale) => sale.shiftId === shift.id && sale.type !== 'shift-close');
  const summary = useMemo(() => {
    const byPayment = { cash: 0, transfer: 0, card: 0, qr_mp: 0, other: 0 };
    shiftSales.forEach((sale) => {
      const method = sale.paymentMethod;
      if (Object.hasOwn(byPayment, method)) {
        byPayment[method] += sale.total;
      } else {
        byPayment.other += sale.total;
      }
    });
    const withdrawals = (shift.withdrawals || []).reduce((sum, item) => sum + item.amount, 0);
    return { byPayment, withdrawals, total: shiftSales.reduce((sum, sale) => sum + sale.total, 0), expectedCash: shift.openingCash + byPayment.cash - withdrawals };
  }, [shift, shiftSales]);

  const submit = (event) => {
    event.preventDefault();
    const actual = Number(cashActual) || 0;
    onCloseShift({ cashActual: actual, cashDifference: actual - summary.expectedCash, closingNotes: notes });
  };

  return <div className="screen close-screen"><div className="screen-header"><div><p className="eyebrow">RENDICIÓN DE TURNO</p><h2>Cerrar turno · {shift.shift}</h2><p className="off-hint">Cajero: {shift.cashier}</p></div><button className="btn-ghost" onClick={onBack}><ArrowLeft size={17} /> Volver a ventas</button></div><div className="summary-grid"><article><span>Ventas totales</span><strong>${summary.total.toFixed(2)}</strong></article><article><span>Efectivo esperado</span><strong>${summary.expectedCash.toFixed(2)}</strong></article><article><span>Retiros</span><strong>${summary.withdrawals.toFixed(2)}</strong></article></div><div className="close-layout"><section className="summary-panel"><h3>Desglose por medio de pago</h3>{Object.entries(paymentLabels).map(([key, label]) => <div className="summary-row" key={key}><span>{label}</span><strong>${summary.byPayment[key].toFixed(2)}</strong></div>)}<h3 className="subheading">Retiros de caja</h3>{(shift.withdrawals || []).length === 0 ? <p className="off-hint">No se registraron retiros.</p> : shift.withdrawals.map((item, index) => <div className="summary-row" key={`${item.createdAt}-${index}`}><span>{item.note || 'Retiro'}</span><strong>-${item.amount.toFixed(2)}</strong></div>)}</section><form className="settings-form close-form" onSubmit={submit}><div className="shift-icon"><Banknote size={24} /></div><h3>Confirmar cierre</h3><label>Efectivo real en caja<input required type="number" min="0" step="0.01" value={cashActual} onChange={(e) => setCashActual(e.target.value)} placeholder="$ 0,00" /></label><label>Observaciones<textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Diferencias, faltantes o novedades" /></label><button className="btn-primary" type="submit"><CheckCircle2 size={18} /> Cerrar y guardar rendición</button></form></div></div>;
}
