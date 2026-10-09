// Servicio de consulta a Open Food Facts (productos) y Open Prices (precios).
// Ambas APIs son gratuitas, sin API key, ideales para autocompletar
// nombre/marca/imagen de un producto a partir de su codigo de barras.

const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v0/product';
const OPEN_PRICES_URL = 'https://prices.openfoodfacts.org/api/v1/prices';

/**
 * Busca un producto por codigo de barras en Open Food Facts.
 * @param {string} barcode
 * @returns {Promise<{found: boolean, name?: string, brand?: string,
 *   quantity?: string, image?: string|null, suggestedPrice?: number|null, error?: boolean}>}
 */
export async function lookupOpenFoodFacts(barcode) {
  try {
    const fields = 'product_name,product_name_es,brands,quantity,image_front_small_url,description';
    const res = await fetch(
      `${OFF_PRODUCT_URL}/${encodeURIComponent(barcode)}.json?fields=${fields}`
    );
    if (!res.ok) return { found: false };

    const data = await res.json();
    if (data.status !== 1) return { found: false };

    const p = data.product ?? {};
    const name = p.product_name_es || p.product_name || p.brands || '';
    const suggestedPrice = await getSuggestedPrice(barcode);

    return {
      found: true,
      name,
      brand: p.brands ?? '',
      quantity: p.quantity ?? '',
      image: p.image_front_small_url ?? null,
      description: p.description ?? '',
      suggestedPrice,
    };
  } catch {
    return { found: false, error: true };
  }
}

export async function lookupUPCitemdb(barcode) {
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`);
    if (!response.ok) return { found: false };
    const data = await response.json();
    const item = data.items?.[0];
    if (!item) return { found: false };
    return {
      found: true,
      name: item.title || '',
      description: item.description || '',
      image: item.images?.[0] || null,
      brand: item.brand || '',
      quantity: item.quantity || '',
      suggestedPrice: null,
    };
  } catch {
    return { found: false, error: true };
  }
}

export async function lookupMercadoLibre(barcode) {
  try {
    // Usamos la API de búsqueda por sitio (MLA = Argentina) y query
    const response = await fetch(`https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(barcode)}`);
    if (!response.ok) return { found: false };
    const data = await response.json();

    const item = data.results?.[0];
    if (!item) return { found: false };

    // Extraemos title y thumbnail (asegurando HTTPS)
    let imageUrl = item.thumbnail ? item.thumbnail.replace('http://', 'https://') : null;
    if (imageUrl && imageUrl.includes('-I.jpg')) {
      imageUrl = imageUrl.replace('-I.jpg', '-V.jpg'); // Versión más grande
    }

    return {
      found: true,
      name: item.title || '',
      brand: '',
      image: imageUrl,
      suggestedPrice: item.price || null,
      source: 'mercadolibre'
    };
  } catch {
    return { found: false, error: true };
  }
}

export async function lookupProductCascade(barcode, lookupGlobal) {
  const normalizedBarcode = barcode.trim();
  if (!normalizedBarcode) return { found: false };

  // 1. Buscar en nuestra base global de Firestore (Aporte de la comunidad)
  const globalProduct = await lookupGlobal(normalizedBarcode);
  if (globalProduct) {
    return {
      found: true,
      source: 'global',
      name: globalProduct.name || '',
      description: globalProduct.description || '',
      image: globalProduct.imageUrl || null,
      suggestedPrice: null,
    };
  }

  // 2. Buscar en Mercado Libre (Excelente para Argentina)
  const mlProduct = await lookupMercadoLibre(normalizedBarcode);
  if (mlProduct.found) return mlProduct;

  // 3. Buscar en Open Food Facts (Productos alimenticios)
  const foodFacts = await lookupOpenFoodFacts(normalizedBarcode);
  if (foodFacts.found) return { ...foodFacts, source: 'open-food-facts' };

  // 4. Buscar en UPCitemdb (Internacional)
  const upcItem = await lookupUPCitemdb(normalizedBarcode);
  return upcItem.found ? { ...upcItem, source: 'upcitemdb' } : { found: false, error: foodFacts.error || upcItem.error };
}

/**
 * Consulta Open Prices y devuelve el precio promedio en ARS (si existe).
 */
async function getSuggestedPrice(barcode) {
  try {
    const res = await fetch(
      `${OPEN_PRICES_URL}?product_code=${encodeURIComponent(barcode)}&size=50`
    );
    if (!res.ok) return null;

    const data = await res.json();
    const arsPrices = (data.items ?? []).filter(
      (item) => item.currency === 'ARS' && typeof item.price === 'number'
    );
    if (arsPrices.length === 0) return null;

    const avg = arsPrices.reduce((acc, item) => acc + item.price, 0) / arsPrices.length;
    return Math.round(avg);
  } catch {
    return null;
  }
}
