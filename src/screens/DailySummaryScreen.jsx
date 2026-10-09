import React, { useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, History, TrendingUp, FileText, DollarSign, Wallet, CreditCard, PieChart as PieChartIcon, BarChart3, QrCode, Landmark } from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { generateSalePDF, openPDFInNewTab } from '../services/pdfGenerator';

function localDate(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const COLORS = ['#0f766e', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'];

export default function DailySummaryScreen({ sales, products = [], onBack }) {
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()));
  const [showHistory, setShowHistory] = useState(false);

  const filteredSales = useMemo(
    () => sales.filter((sale) => sale.type !== 'shift-close' && localDate(sale.createdAt) === selectedDate),
    [sales, selectedDate]
  );

  const summary = useMemo(() => {
    const byPayment = { cash: 0, qr: 0, transfer: 0, card: 0 };
    const byCategory = {};
    let totalCost = 0;

    filteredSales.forEach((sale) => {
      // Mapeo detallado de medios de pago
      const method = String(sale.paymentMethod || 'cash').toLowerCase();
      let pKey = 'cash';
      if (method === 'qr_mp' || method === 'qr') pKey = 'qr';
      else if (method === 'transferencia' || method === 'transfer') pKey = 'transfer';
      else if (method === 'tarjeta' || method === 'card') pKey = 'card';

      byPayment[pKey] = (byPayment[pKey] || 0) + (Number(sale.total) || 0);

      if (sale.items) {
        sale.items.forEach(item => {
          const product = products.find(p => p.id === item.productId || p.barcode === item.barcode);
          if (product && product.cost) {
            totalCost += (Number(product.cost) * Number(item.quantity));
          }
          const cat = (product?.category) || 'General';
          byCategory[cat] = (byCategory[cat] || 0) + (Number(item.price) * Number(item.quantity));
        });
      }
    });

    const totalRevenue = filteredSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    const profit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

    const categoryData = Object.entries(byCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const paymentData = [
      { name: 'Efectivo', value: byPayment.cash, fill: '#0f766e' },
      { name: 'QR', value: byPayment.qr, fill: '#14b8a6' },
      { name: 'Transf.', value: byPayment.transfer, fill: '#2dd4bf' },
      { name: 'Tarjeta', value: byPayment.card, fill: '#5eead4' }
    ];

    return {
      total: totalRevenue,
      byPayment,
      totalCost,
      profit,
      margin,
      categoryData,
      paymentData
    };
  }, [filteredSales, products]);

  const closedShifts = sales
    .filter((sale) => sale.type === 'shift-close')
    .filter((shift) => showHistory || localDate(shift.closedAt) === selectedDate)
    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

  const handleViewPDF = async (sale) => {
    const pdf = await generateSalePDF(sale, { storeName: 'Mi Comercio', ...sale });
    openPDFInNewTab(pdf);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto pb-10">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-teal-900 flex items-center gap-2">
            <BarChart3 className="text-teal-600" /> Balance e Historial
          </h2>
          <p className="text-sm text-gray-500">Analizá el rendimiento de tu negocio en tiempo real.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="date"
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded-lg hover:bg-teal-100 transition-colors"
            onClick={onBack}
          >
            <ArrowLeft size={17} /> Volver
          </button>
        </div>
      </div>

      <div className="p-6 max-w-[1600px] mx-auto w-full space-y-6">

        {/* Summary Cards Grid - 6 Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Total Vendido</p>
              <h3 className="text-xl font-bold text-gray-800 mt-1">${summary.total.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-teal-50 rounded-lg text-teal-600">
              <DollarSign size={18} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Rentabilidad</p>
              <h3 className={`text-xl font-bold mt-1 ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${summary.profit.toLocaleString()}
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${summary.profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              <TrendingUp size={18} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Efectivo</p>
              <h3 className="text-xl font-bold text-gray-800 mt-1">${summary.byPayment.cash.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
              <Wallet size={18} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">QR (MP)</p>
              <h3 className="text-xl font-bold text-gray-800 mt-1">${summary.byPayment.qr.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <QrCode size={18} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Transferencia</p>
              <h3 className="text-xl font-bold text-gray-800 mt-1">${summary.byPayment.transfer.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <Landmark size={18} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tarjeta</p>
              <h3 className="text-xl font-bold text-gray-800 mt-1">${summary.byPayment.card.toLocaleString()}</h3>
            </div>
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <CreditCard size={18} />
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Category Donut Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h4 className="font-bold text-gray-800 flex items-center gap-2">
                <PieChartIcon size={18} className="text-teal-600" /> Ventas por Rubro
              </h4>
              <span className="text-xs text-gray-400 font-medium">DISTRIBUCIÓN %</span>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4">
              <div className="w-full md:w-1/2 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary.categoryData.length > 0 ? summary.categoryData : [{ name: 'Sin datos', value: 1 }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {summary.categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                      {summary.categoryData.length === 0 && <Cell fill="#f3f4f6" />}
                    </Pie>
                    <Tooltip
                      formatter={(value) => `$${Number(value).toLocaleString()}`}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="w-full md:w-1/2 space-y-3">
                {summary.categoryData.slice(0, 6).map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between group">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                      <span className="text-sm text-gray-600 font-medium truncate max-w-[120px]">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-gray-800">${item.value.toLocaleString()}</span>
                      <p className="text-[10px] text-gray-400 uppercase font-bold">{((item.value / (summary.total || 1)) * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                ))}
                {summary.categoryData.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-10 italic">No hay registros hoy</p>
                )}
              </div>
            </div>
          </div>

          {/* Payment Methods Bar Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h4 className="font-bold text-gray-800 flex items-center gap-2">
                <BarChart3 size={18} className="text-teal-600" /> Medios de Pago
              </h4>
              <button
                className={`text-xs font-bold px-3 py-1 rounded-full transition-colors ${showHistory ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                onClick={() => setShowHistory(!showHistory)}
              >
                {showHistory ? 'HISTORIAL ACTIVO' : 'VER HISTORIAL'}
              </button>
            </div>

            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.paymentData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} dy={10} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    formatter={(value) => `$${Number(value).toLocaleString()}`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Detailed Sales List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <h4 className="font-bold text-gray-800 flex items-center gap-2">
              <History size={18} className="text-teal-600" /> Detalle de Ventas
            </h4>
          </div>
          <div className="divide-y divide-gray-100 max-h-[400px] overflow-auto">
            {filteredSales.length === 0 ? (
              <div className="py-12 text-center text-gray-400 italic">No hay ventas registradas para este día.</div>
            ) : (
              filteredSales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((sale) => (
                <div className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors" key={sale.id}>
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
                       <FileText size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">
                        {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        <span className="mx-2 text-gray-300">|</span>
                        <span className="capitalize">{sale.paymentMethod?.replace('_mp', '').replace('qr', 'QR')}</span>
                      </p>
                      <p className="text-xs text-gray-500">{sale.items?.length || 0} productos</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-base font-bold text-gray-900">${Number(sale.total).toFixed(2)}</span>
                    <button
                      className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                      onClick={() => handleViewPDF(sale)}
                    >
                      <FileText size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Shift History Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-teal-600 text-white flex items-center justify-between">
            <h4 className="font-bold flex items-center gap-2">
              <TrendingUp size={18} /> Turnos Cerrados
            </h4>
            <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded uppercase tracking-tighter">Historial</span>
          </div>
          <div className="divide-y divide-gray-100">
            {closedShifts.length === 0 ? (
              <div className="py-8 text-center text-gray-400 italic">No hay turnos cerrados para este filtro.</div>
            ) : (
              closedShifts.map((shift) => (
                <div className="px-6 py-4 flex items-center justify-between" key={shift.id}>
                  <div>
                    <p className="text-sm font-bold text-gray-800 uppercase">{shift.shift} · {shift.cashier}</p>
                    <p className="text-xs text-gray-500">{new Date(shift.closedAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-teal-700">${Number(shift.total || 0).toLocaleString()}</p>
                    <p className={`text-[10px] font-bold ${Number(shift.cashDifference) < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      DIFERENCIA: ${Number(shift.cashDifference || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
