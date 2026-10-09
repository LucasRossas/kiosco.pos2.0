/**
 * Utilidades para manejo de dinero y redondeo consistente
 */

export function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function lineTotal(price, quantity) {
  return round2(price * quantity);
}
