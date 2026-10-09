import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Search, Camera } from 'lucide-react';
import { toast } from 'sonner';
import ProductModal from '../components/ProductModal';
import BarcodeScanner from '../components/BarcodeScanner';
import ReferenceListPrint from './ReferenceListPrint';
import { useScanner } from '../context/scannerHooks.js';

export default function ProductsScreen({ products, plan, storeName, onSaveProduct, onDeleteProduct, onDeleteProducts }) {
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [initialBarcode, setInitialBarcode] = useState('');
  const [isReferencePrintOpen, setIsReferencePrintOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const { openScanner } = useScanner();

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      (p.barcode || '').toLowerCase().includes(query.toLowerCase()) ||
      (p.shortReference || '').toLowerCase().includes(query.toLowerCase())
  );

  const openNew = () => {
    setEditingProduct(null);
    setInitialBarcode('');
    setIsModalOpen(true);
  };

  const handleScan = (barcode) => {
    setIsScannerOpen(false);
    setEditingProduct(null);
    setInitialBarcode(barcode);
    setIsModalOpen(true);
  };

  const openEdit = (product) => {
    setEditingProduct(product);
    setIsModalOpen(true);
  };

  const handleSave = (data) => {
    const ok = onSaveProduct(data, editingProduct?.id ?? null);
    if (ok) setIsModalOpen(false);
  };

  const handleDelete = (product) => {
    onDeleteProduct(product.id);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filtered.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`¿Estás seguro de que deseás eliminar ${selectedIds.length} productos?`)) {
      await onDeleteProducts(selectedIds);
      toast.success(`${selectedIds.length} productos eliminados correctamente.`);
      setSelectedIds([]);
    }
  };

  return (
    <div className="screen touch-pan-y">
      <div className="screen-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2>Carga de Productos</h2>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            Total de productos cargados: {products.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedIds.length > 0 && (
            <button className="btn-primary danger" onClick={handleBulkDelete}>
              <Trash2 size={18} /> Eliminar seleccionados ({selectedIds.length})
            </button>
          )}
          <div className="search-inline">
            <Search size={18} color="#6b7280" />
            <input
              type="text"
              placeholder="Buscar por nombre o código..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={openNew}>
            <Plus size={18} /> Nuevo Producto
          </button>
          <button className="btn-scan" onClick={() => setIsScannerOpen(true)} title="Escanear código con cámara">
            <Camera size={18} /> Escanear
          </button>
          <button className="btn-secondary scanner-link-button" onClick={() => openScanner('inventory')} title="Vincular lector QR">
            Vincular lector QR
          </button>
          <button className="btn-secondary" onClick={() => setIsReferencePrintOpen(true)}>Imprimir Lista de Referencias</button>
        </div>
      </div>

      <div className="overflow-x-auto w-full touch-pan-y">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={filtered.length > 0 && selectedIds.length === filtered.length}
                />
              </th>
              <th>Producto</th>
              <th>Código</th>
              <th>Categoría</th>
              {plan !== 'kiosco' && <th>Tipo</th>}
              <th>Precio</th>
              <th>Stock</th>
              <th style={{ width: 100 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={plan === 'kiosco' ? 7 : 8} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
                  No hay productos que coincidan.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => handleSelectOne(p.id)}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.imageUrl && p.imageUrl.length <= 4 ? (
                        <span style={{ fontSize: '1.5rem', minWidth: '24px', textAlign: 'center' }}>{p.imageUrl}</span>
                      ) : p.imageUrl ? (
                        <img src={p.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                      ) : null}
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td>{p.barcode || `Ref. ${p.shortReference}`}</td>
                  <td>{p.category || 'General'}</td>
                  {plan !== 'kiosco' && <td>{p.isByWeight ? 'Por peso (kg)' : 'Unidad'}</td>}
                  <td>${p.price}</td>
                  <td>{p.isByWeight ? `${p.stock} kg` : `${p.stock} u`}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="Editar" onClick={() => openEdit(p)}>
                        <Pencil size={16} />
                      </button>
                      <button className="btn-icon danger" title="Eliminar" onClick={() => handleDelete(p)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <ProductModal
          product={editingProduct}
          products={products}
          plan={plan}
          initialBarcode={initialBarcode}
          onSave={handleSave}
          onClose={() => { setIsModalOpen(false); setInitialBarcode(''); }}
        />
      )}
      {isScannerOpen && <BarcodeScanner onScan={handleScan} onClose={() => setIsScannerOpen(false)} />}
      {isReferencePrintOpen && <ReferenceListPrint products={products} storeName={storeName} onClose={() => setIsReferencePrintOpen(false)} />}
    </div>
  );
}
