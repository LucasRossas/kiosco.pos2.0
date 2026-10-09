import jsPDF from 'jspdf';
import 'jspdf-autotable';

/**
 * Genera un PDF de Factura C (A4) o Ticket (80mm) según la configuración.
 */
export async function generateSalePDF(sale, settings) {
  const isA4 = settings.invoiceFormat === 'A4';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: isA4 ? 'a4' : [80, 297], // 80mm ancho para ticket térmico
  });

  const margin = 10;
  let currentY = 15;

  // Encabezado
  doc.setFontSize(18);
  doc.text(settings.storeName || 'PuntoGestión', margin, currentY);
  currentY += 7;

  doc.setFontSize(10);
  doc.text(`Fecha: ${new Date(sale.createdAt).toLocaleString('es-AR')}`, margin, currentY);
  currentY += 5;
  doc.text(`Comprobante Nro: ${sale.id.substring(0, 8).toUpperCase()}`, margin, currentY);
  currentY += 10;

  // Datos del Comercio
  if (settings.arcaConfig?.cuit) {
    doc.setFontSize(9);
    doc.text(`CUIT: ${settings.arcaConfig.cuit}`, margin, currentY);
    currentY += 4;
    doc.text(`IIBB: ${settings.arcaConfig.iibb || 'Exento'}`, margin, currentY);
    currentY += 4;
    doc.text(`Inicio Actividades: ${settings.arcaConfig.inicioActividades || '-'}`, margin, currentY);
    currentY += 8;
  }

  // Tabla de Productos
  const tableData = sale.items.map(item => [
    item.name,
    item.quantity.toFixed(item.isByWeight ? 3 : 0),
    `$${Number(item.price).toFixed(2)}`,
    `$${(item.price * item.quantity).toFixed(2)}`
  ]);

  doc.autoTable({
    startY: currentY,
    head: [['Producto', 'Cant', 'Precio', 'Subtotal']],
    body: tableData,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [63, 81, 181] },
  });

  currentY = doc.lastAutoTable.finalY + 10;

  // Totales
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(`TOTAL: $${Number(sale.total).toFixed(2)}`, margin, currentY);
  currentY += 6;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Medio de pago: ${sale.paymentMethod}`, margin, currentY);
  currentY += 10;

  // Pie de página / Factura Electrónica
  if (sale.cae) {
    doc.setDrawColor(200);
    doc.line(margin, currentY, isA4 ? 200 : 70, currentY);
    currentY += 5;
    doc.setFontSize(10);
    doc.text(`CAE: ${sale.cae}`, margin, currentY);
    currentY += 5;
    doc.text(`Vto. CAE: ${sale.caeVto}`, margin, currentY);
  }

  if (settings.ticketFooter) {
    currentY += 10;
    doc.setFontSize(8);
    doc.text(settings.ticketFooter, margin, currentY, { maxWidth: isA4 ? 180 : 60 });
  }

  return doc;
}

export function downloadPDF(doc, filename) {
  doc.save(filename);
}

export function openPDFInNewTab(doc) {
  const string = doc.output('bloburl');
  window.open(string, '_blank');
}
