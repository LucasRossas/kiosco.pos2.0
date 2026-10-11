export const SPECIAL_CATEGORIES = new Set(['Verdulería', 'Fiambrería', 'Carnicería', 'Panadería']);

/**
 * Determina si se debe descontar stock para un producto.
 * Mantiene consistencia con processSaleTransaction en el frontend.
 * @param {Object} product Datos del producto del tenant
 * @returns {boolean}
 */
export function isStockTracked(product) {
  const isSpecial = SPECIAL_CATEGORIES.has(product.category);
  return !isSpecial;
}
