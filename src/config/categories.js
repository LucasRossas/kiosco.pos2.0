/**
 * Configuración centralizada de categorías y lógica de negocio asociada.
 * Mantiene la consistencia entre el Frontend y el Backend.
 */

export const SPECIAL_CATEGORIES = ['Verdulería', 'Fiambrería', 'Carnicería', 'Panadería'];

export const CATEGORIES_CONFIG = [
  { id: 'General', label: 'General', icon: '📦' },
  { id: 'Almacén', label: 'Almacén', icon: '🛒' },
  { id: 'Quiosco', label: 'Quiosco', icon: '🍬' },
  { id: 'Fiambrería', label: 'Fiambrería', icon: '🧀', isSpecial: true, isWeight: true },
  { id: 'Verdulería', label: 'Verdulería', icon: '🍎', isSpecial: true, isWeight: true },
  { id: 'Carnicería', label: 'Carnicería', icon: '🥩', isSpecial: true, isWeight: true },
  { id: 'Panadería', label: 'Panadería', icon: '🥖', isSpecial: true, isWeight: true },
  { id: 'Otros', label: 'Otros', icon: '➕' }
];

/**
 * Determina si una categoría es especial (no descuenta stock por defecto)
 */
export const isSpecialCategory = (categoryName) => SPECIAL_CATEGORIES.includes(categoryName);

/**
 * Determina si se debe trackear el stock para un item específico
 */
export const shouldTrackStock = (item) => {
  if (item.trackStock !== undefined) return item.trackStock;
  return !isSpecialCategory(item.category);
};
