import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { lookupProductCascade } from '../services/openFoodFacts';
import { loadGlobalProduct } from '../services/firebase';

const VERDULERIA_DICTIONARY = [
  { name: "papa", icon: "🥔" },
  { name: "cebolla", icon: "🧅" },
  { name: "zanahoria", icon: "🥕" },
  { name: "tomate", icon: "🍅" },
  { name: "lechuga", icon: "🥬" },
  { name: "ajo", icon: "🧄" },
  { name: "pimiento", icon: "🫑" },
  { name: "morron", icon: "🫑" },
  { name: "zapallo", icon: "🎃" },
  { name: "batata", icon: "🍠" },
  { name: "berenjena", icon: "🍆" },
  { name: "choclo", icon: "🌽" },
  { name: "pepino", icon: "🥒" },
  { name: "brocoli", icon: "🥦" },
  { name: "limon", icon: "🍋" },
  { name: "manzana", icon: "🍎" },
  { name: "banana", icon: "🍌" },
  { name: "naranja", icon: "🍊" },
  { name: "pera", icon: "🍐" },
  { name: "uva", icon: "🍇" },
  { name: "frutilla", icon: "🍓" },
  { name: "palta", icon: "🥑" },
];

const MEAT_IMAGES = {
  "molida": "/Imagenes de carnes/MOLIDA.png",
  "picada": "/Imagenes de carnes/MOLIDA.png",
  "roast beef": "/Imagenes de carnes/ROAST BEEF.png",
  "vacio": "/Imagenes de carnes/VACIO.png",
  "asado": "/Imagenes de carnes/COSTILLA.png",
  "costilla": "/Imagenes de carnes/COSTILLA.png",
  "matambre": "/Imagenes de carnes/MATAMBRE.png",
  "peceto": "/Imagenes de carnes/PECETO.png",
  "nalga": "/Imagenes de carnes/NALGA.png",
  "bola de lomo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "cuadril": "/Imagenes de carnes/CUADRIL.png",
  "colita de cuadril": "/Imagenes de carnes/COLITA DE CUADRIL.png",
  "lomo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "bife de chorizo": "/Imagenes de carnes/BOLA DE LOMO.png",
  "ojo de bife": "/Imagenes de carnes/ROAST BEEF.png",
  "entraña": "/Imagenes de carnes/ENTRAÑA.png",
  "falda": "/Imagenes de carnes/COSTILLA.png",
  "osobuco": "/Imagenes de carnes/OSOBUCO.png",
  "paleta": "/Imagenes de carnes/PALETA.png",
  "tapa de asado": "/Imagenes de carnes/TAPA DE ASADO.png",
  "tapa de nalga": "/Imagenes de carnes/TAPA DE NALGA.png",
  "palomita": "/Imagenes de carnes/PALOMITA.png",
  "marucha": "/Imagenes de carnes/MARUCHA.png",
  "cuadrada": "/Imagenes de carnes/CUADRADA.png",
  "espinazo": "/Imagenes de carnes/ESPINAZO.png",
};

const normalizeText = (text) => {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const inputClass = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white";

export default function ProductModal({ product = null, products = [], initialBarcode = '', plan = 'mercado', onSave, onClose }) {
  const isEditing = Boolean(product);
  const isKiosco = plan === 'kiosco';

  const getNextShortReference = () => {
    const maxRef = Math.max(0, ...products.map(p => parseInt(p.shortReference) || 0));
    return (maxRef + 1).toString();
  };

  const [generateInternalCode, setGenerateInternalCode] = useState(
    isEditing ? (!!product?.shortReference && !product?.barcode) : false
  );

  const [form, setForm] = useState({
    name: product?.name ?? '',
    barcode: product?.barcode ?? initialBarcode,
    shortReference: product?.shortReference ?? '',
    category: product?.category ?? '',
    price: product?.price?.toString() ?? '',
    stock: product?.stock?.toString() ?? '',
    isByWeight: product?.isByWeight ?? false,
    description: product?.description ?? '',
    imageUrl: product?.imageUrl ?? '',
  });
  const [off, setOff] = useState({ status: 'idle', info: null });
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestedVisual, setSuggestedVisual] = useState(null);
  const [selectedEmoji, setSelectedEmoji] = useState(
    product?.imageUrl && product.imageUrl.length <= 4 ? product.imageUrl : null
  );

  const isWeightOnlyCategory = ['Verdulería', 'Fiambrería', 'Carnicería'].includes(form.category);

  useEffect(() => {
    if (isWeightOnlyCategory) {
      // La categoría determina este campo del formulario.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(f => ({ ...f, isByWeight: true }));
    }
  }, [form.category, isWeightOnlyCategory]);

  const searchBarcodeData = async (code = form.barcode) => {
    if (!code) return;
    setOff({ status: 'loading', info: null });

    try {
      const result = await lookupProductCascade(code.trim(), loadGlobalProduct);
      if (result.found) {
        setOff({ status: 'found', info: result });

        // Si encontramos una imagen real en la API, limpiamos el emoji seleccionado
        if (result.image) {
          setSelectedEmoji(null);
        }

        setForm((f) => ({
          ...f,
          name: f.name || result.name,
          price: f.price || (result.suggestedPrice ? String(result.suggestedPrice) : ''),
          description: f.description || result.description || '',
          imageUrl: result.image || f.imageUrl || '',
        }));
      } else {
        setOff({ status: 'notfound', info: null });
      }
    } catch (error) {
      console.error("Error en búsqueda de código:", error);
      setOff({ status: 'notfound', info: null });
    }
  };

  useEffect(() => {
    if (!isEditing && /^\d{8,13}$/.test(initialBarcode)) {
      // El autocompletado se dispara una sola vez al abrir el modal.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      searchBarcodeData(initialBarcode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const price = Number(form.price);
    const stock = isWeightOnlyCategory ? null : (form.stock === '' ? 0 : Number(form.stock));
    const barcode = form.barcode.trim();
    const shortRef = generateInternalCode ? form.shortReference.trim() : '';

    if (!name || !Number.isFinite(price) || price < 0) return;
    if (!isWeightOnlyCategory && (!Number.isFinite(stock) || stock < 0)) return;

    if (!form.category) {
      toast.error('La categoría es obligatoria.');
      return;
    }

    // Validación según tipo de código
    if (generateInternalCode) {
      if (!shortRef) {
        toast.error('Se requiere un código de referencia interna.');
        return;
      }
      const isDuplicate = products.some(p =>
        p.shortReference === shortRef && p.id !== product?.id
      );
      if (isDuplicate) {
        toast.error(`La referencia rápida '${shortRef}' ya está asignada a otro producto.`);
        return;
      }
    } else {
      if (!barcode) {
        toast.error('Ingresa un código de barras o activa la generación interna.');
        return;
      }
    }

    if (isKiosco && form.isByWeight) {
      toast.error('El Plan Kiosco no permite productos por peso. Actualizá al Plan Mercado.');
      return;
    }

    onSave({
      name,
      barcode: generateInternalCode ? '' : barcode,
      shortReference: shortRef,
      price,
      stock,
      isByWeight: isKiosco ? false : form.isByWeight,
      category: form.category,
      description: form.description.trim(),
      imageUrl: form.imageUrl.trim(),
    });
  };

  const handleSelectSuggestion = (item) => {
    setForm({
      ...form,
      name: item.name,
      category: 'Verdulería',
      isByWeight: true,
      imageUrl: item.icon,
    });
    setSelectedEmoji(item.icon);
    setSuggestions([]);
    setShowSuggestions(false);
    setSuggestedVisual(null);
  };

  return (
    <div className="modal-overlay p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-auto relative flex flex-col max-h-[98vh] overflow-hidden">

        {/* Header */}
        <div className="px-4 py-2.5 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-lg font-bold text-[#1a2b4b]">
            {isEditing ? 'Editar Producto' : 'Nuevo Producto'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-all"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="px-4 py-2.5 overflow-y-auto flex-1 flex flex-col gap-2 custom-scrollbar">

          {/* Vista Previa de Imagen/Emoji */}
          {form.imageUrl && (
            <div className="flex justify-center mb-1">
              {form.imageUrl.startsWith('/') || form.imageUrl.startsWith('http') ? (
                <img
                  src={form.imageUrl}
                  alt="Vista previa"
                  className="w-16 h-16 object-contain rounded-lg border border-gray-200 shadow-sm bg-white"
                />
              ) : (
                <div className="w-16 h-16 flex items-center justify-center bg-blue-50 border border-blue-100 rounded-lg shadow-sm text-4xl">
                  {form.imageUrl}
                </div>
              )}
            </div>
          )}

          {/* Nombre */}
          <div className="relative">
            <input
              type="text"
              placeholder="Nombre del producto"
              required
              value={form.name}
              onChange={(e) => {
                const val = e.target.value;
                setForm({ ...form, name: val });

                const cleanVal = normalizeText(val);

                if (!isKiosco && cleanVal.length >= 3) {
                  // 1. Buscar en Carnes
                  const meatMatch = Object.entries(MEAT_IMAGES).find(([key]) => {
                    const normalizedKey = normalizeText(key);
                    return normalizedKey.startsWith(cleanVal) || cleanVal.includes(normalizedKey);
                  });

                  if (meatMatch) {
                    setSuggestedVisual({
                      key: meatMatch[0],
                      value: meatMatch[1],
                      type: 'image',
                      category: 'Carnicería'
                    });
                  } else {
                    // 2. Buscar en Verduras
                    const vegMatch = VERDULERIA_DICTIONARY.find(item => {
                      const normalizedKey = normalizeText(item.name);
                      return normalizedKey.startsWith(cleanVal) || cleanVal.includes(normalizedKey);
                    });

                    if (vegMatch) {
                      setSuggestedVisual({
                        key: vegMatch.name,
                        value: vegMatch.icon,
                        type: 'icon',
                        category: 'Verdulería'
                      });
                    } else {
                      setSuggestedVisual(null);
                    }
                  }
                } else {
                  setSuggestedVisual(null);
                }

                if (!isKiosco && val.trim()) {
                  const filtered = VERDULERIA_DICTIONARY.filter(item =>
                    item.name.toLowerCase().includes(val.toLowerCase())
                  );
                  setSuggestions(filtered);
                  setShowSuggestions(true);
                } else {
                  setSuggestions([]);
                  setShowSuggestions(false);

                  // BUG 2: Solo limpiar la imagen auto-sugerida si el texto está realmente vacío
                  // Evita borrar imágenes manuales o emojis previos mientras se escribe en Plan Kiosco
                  if (!val.trim()) {
                    setSelectedEmoji(null);
                    if (form.imageUrl && (form.imageUrl.startsWith('/Imagenes') || form.imageUrl.length <= 4)) {
                      setForm(prev => ({ ...prev, imageUrl: '' }));
                    }
                  }
                }
              }}
              onFocus={() => {
                if (form.name.trim()) setShowSuggestions(true);
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className={`${inputClass} ${selectedEmoji ? 'pr-10' : ''}`}
              autoComplete="off"
            />
            {selectedEmoji && (
              <span className="absolute right-3 top-2 text-xl pointer-events-none">{selectedEmoji}</span>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-xl mt-1 max-h-48 overflow-y-auto">
                {suggestions.map((item, index) => (
                  <li
                    key={'sugg-' + index}
                    onClick={() => handleSelectSuggestion(item)}
                    className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex items-center gap-2 text-sm border-b last:border-b-0 border-gray-50"
                  >
                    <span className="text-lg">{item.icon}</span> {item.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Sugerencia Visual Unificada (Banner) */}
          {suggestedVisual && form.imageUrl !== suggestedVisual.value && (
            <div className="mx-1 p-2 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg border border-blue-200 overflow-hidden bg-white shadow-sm flex items-center justify-center">
                  {suggestedVisual.type === 'image' ? (
                    <img src={suggestedVisual.value} alt="Sugerencia" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-2xl">{suggestedVisual.value}</span>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black text-blue-600 uppercase">¿Es {suggestedVisual.key}?</p>
                  <p className="text-[9px] text-blue-400 font-bold">
                    {suggestedVisual.type === 'image' ? 'Tengo una foto lista' : 'Usar este ícono'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setForm({
                    ...form,
                    name: suggestedVisual.key,
                    imageUrl: suggestedVisual.value,
                    category: suggestedVisual.category,
                    isByWeight: true
                  });
                  setSuggestedVisual(null);
                  if (suggestedVisual.type === 'icon') {
                    setSelectedEmoji(suggestedVisual.value);
                  } else {
                    setSelectedEmoji(null);
                  }
                  toast.info(`${suggestedVisual.type === 'image' ? 'Imagen' : 'Icono'} de ${suggestedVisual.key} aplicado`);
                }}
                className="px-2 py-1.5 bg-blue-600 text-white text-[9px] font-black rounded-lg shadow-md active:scale-95 transition-all uppercase"
              >
                {suggestedVisual.type === 'image' ? 'USAR FOTO' : 'USAR ÍCONO'}
              </button>
            </div>
          )}

          {/* Barcode Section */}
          <div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Código de barras o PLU"
                disabled={generateInternalCode}
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className={`${inputClass} ${generateInternalCode ? 'bg-gray-50 opacity-50 cursor-not-allowed' : ''}`}
              />
              <button
                type="button"
                onClick={() => searchBarcodeData()}
                disabled={off.status === 'loading' || !form.barcode || generateInternalCode}
                className="bg-[#ffc168] hover:bg-[#ffb347] text-white px-3 rounded-lg font-bold transition-all disabled:opacity-50 whitespace-nowrap text-sm"
              >
                {off.status === 'loading' ? '...' : 'Buscar'}
              </button>
            </div>

            {/* Toggle Generar Código Interno */}
            <div className="flex items-center gap-2 mt-2 px-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={generateInternalCode}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setGenerateInternalCode(checked);
                    if (checked && !form.shortReference) {
                      setForm(f => ({ ...f, shortReference: getNextShortReference() }));
                    }
                  }}
                />
                <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ml-2 text-[11px] font-semibold text-gray-600">
                  Generar código interno (para productos sin código de fábrica)
                </span>
              </label>
            </div>
          </div>

          {/* Short Reference (Conditional) */}
          {generateInternalCode && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
              <input
                type="text"
                placeholder="Referencia rápida (ej. 01, 02)"
                required
                value={form.shortReference}
                onChange={(e) => setForm({ ...form, shortReference: e.target.value })}
                className={`${inputClass} border-blue-200 bg-blue-50/30 font-bold text-blue-900`}
              />
              <p className="text-[10px] text-blue-500 mt-1 leading-tight px-1 font-medium">
                Este código se usará para identificar el producto en el POS.
              </p>
            </div>
          )}

          {/* Row agrupada para Rubro, Precio y Stock */}
          <div className={`grid ${isWeightOnlyCategory ? 'grid-cols-2' : 'grid-cols-3'} gap-2 items-center`}>
            <div>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none appearance-none bg-white pr-6 text-gray-700 font-medium"
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%236b7280\' stroke-width=\'2\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '10px' }}
              >
                <option value="" disabled>Selecciona un rubro...</option>
                {['Quiosco', 'General', 'Almacén', ...(!isKiosco ? ['Fiambrería', 'Verdulería', 'Carnicería'] : [])].map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
              </select>
            </div>

            <div>
              <input
                type="number"
                placeholder="Precio"
                required
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className={inputClass}
              />
            </div>

            {!isWeightOnlyCategory && (
              <div>
                <input
                  type="number"
                  placeholder="Stock"
                  required
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className={inputClass}
                />
              </div>
            )}
          </div>

          {/* Weight Checkbox */}
          {!isKiosco && (
            <label className="flex items-center gap-2 cursor-pointer mt-0.5 px-1">
              <input
                type="checkbox"
                checked={form.isByWeight}
                disabled={isWeightOnlyCategory}
                onChange={(e) => setForm({ ...form, isByWeight: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600 font-medium">¿Es producto por peso?</span>
            </label>
          )}
        </form>

        {/* Footer Actions */}
        <div className="p-4 pt-1">
          <button
            type="submit"
            onClick={handleSubmit}
            className="w-full bg-[#2b5ae9] hover:bg-[#1e44c2] text-white font-bold text-base rounded-lg py-2 transition-all shadow-md active:scale-[0.99]"
          >
            {isEditing ? 'Guardar Cambios' : 'Guardar Producto'}
          </button>
        </div>
      </div>
    </div>
  );
}
