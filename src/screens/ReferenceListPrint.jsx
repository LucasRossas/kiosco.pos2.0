import React from 'react';
import { X } from 'lucide-react';

export default function ReferenceListPrint({ products, storeName, onClose }) {
  const references = products.filter((product) => product.shortReference).sort((a, b) => String(a.shortReference).localeCompare(String(b.shortReference), 'es', { numeric: true }));

  return <div className="modal-overlay reference-print-overlay"><div className="reference-print-modal"><div className="reference-print-actions no-print"><h3>Lista de referencias</h3><button className="btn-icon" onClick={onClose} title="Cerrar"><X size={20} /></button></div><section className="reference-sheet print-reference-sheet"><header><strong>{storeName || 'PuntoGestión'}</strong><span>Lista de referencias</span></header><table><thead><tr><th>REF</th><th>Producto</th><th>Precio</th><th>Unidad</th></tr></thead><tbody>{references.length === 0 ? <tr><td colSpan="4">No hay productos con referencia corta.</td></tr> : references.map((product) => <tr key={product.id}><td>{product.shortReference}</td><td>{product.name}</td><td>$ {Number(product.price || 0).toLocaleString('es-AR')}</td><td>{product.isByWeight ? 'Kg' : 'Un.'}</td></tr>)}</tbody></table><footer>Impreso el {new Date().toLocaleDateString('es-AR')}</footer></section><div className="reference-print-actions no-print"><button className="btn-primary" onClick={() => window.print()}>Imprimir lista</button></div></div></div>;
}
