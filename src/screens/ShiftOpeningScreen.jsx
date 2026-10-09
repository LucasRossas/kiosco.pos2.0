import React, { useState } from 'react';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { toast } from 'sonner';

export default function ShiftOpeningScreen({
  storeName,
  onOpen,
  onBack,
  theme = 'plan-kiosco',
  plan = 'kiosco',
  title = 'Abrir turno de caja',
  description = 'Ingresá los datos del cajero para comenzar a registrar ventas.'
}) {
  const isKiosco = plan === 'kiosco';
  const [form, setForm] = useState({ registerName: 'Caja 1', cashier: '', shift: 'mañana', openingCash: '', notes: '' });

  const submit = (event) => {
    event.preventDefault();
    if (isKiosco && form.registerName !== 'Caja 1') {
      toast.error('El Plan Kiosco solo permite 1 caja activa. Actualizá al Plan Mercado.');
      return;
    }
    onOpen({ ...form, openingCash: Number(form.openingCash) || 0, openedAt: new Date().toISOString() });
  };

  return (
    <div className={`shift-page ${theme} py-4 min-h-screen flex items-center justify-center`}>
      <div className="shift-card my-auto max-h-[95vh] overflow-y-auto !py-4 !px-6 scale-[0.95] origin-center">
        <button type="button" className="btn-ghost back-button !mb-1" onClick={onBack}>
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="flex items-center gap-3 mb-2 mt-1">
          <div className="shift-icon !m-0 !w-10 !h-10"><Clock3 size={20} /></div>
          <div>
            <p className="eyebrow text-xs opacity-75 !m-0">{storeName}</p>
            <h1 className="shift-title !text-xl !m-0">{title}</h1>
          </div>
        </div>
        <p className="shift-description !text-xs !mb-3">{description}</p>
        <form className="settings-form shift-form grid grid-cols-2 gap-x-4 gap-y-2" onSubmit={submit}>
          <label className="col-span-2 sm:col-span-1 !gap-1 !text-xs">
            Nombre de la caja
            <select
              required
              className="!py-1.5 !text-sm"
              value={form.registerName}
              onChange={(e) => setForm({ ...form, registerName: e.target.value })}
              disabled={isKiosco}
            >
              <option value="Caja 1">Caja 1</option>
              {!isKiosco && (
                <>
                  <option value="Caja 2">Caja 2</option>
                  <option value="Caja 3">Caja 3</option>
                </>
              )}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1 !gap-1 !text-xs">
            Nombre del cajero
            <input required className="!py-1.5 !text-sm" value={form.cashier} onChange={(e) => setForm({ ...form, cashier: e.target.value })} placeholder="Nombre del cajero" />
          </label>
          <label className="col-span-2 sm:col-span-1 !gap-1 !text-xs">
            Turno
            <select className="!py-1.5 !text-sm" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              <option value="mañana">Mañana</option>
              <option value="tarde">Tarde</option>
              <option value="noche">Noche</option>
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1 !gap-1 !text-xs">
            Monto inicial en caja
            <input required className="!py-1.5 !text-sm" type="number" min="0" step="0.01" value={form.openingCash} onChange={(e) => setForm({ ...form, openingCash: e.target.value })} placeholder="$ 0,00" />
          </label>
          <label className="col-span-2 !gap-1 !text-xs">
            Descripción / observaciones
            <textarea className="!py-1.5 !text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ej. Faltan billetes de cambio" rows="1" />
          </label>
          <button className="btn-primary col-span-2 !py-2 !mt-2 text-sm" type="submit">
            <Clock3 size={16} /> Abrir caja
          </button>
        </form>
      </div>
    </div>
  );
}
