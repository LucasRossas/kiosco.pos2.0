import { ArrowLeft, Banknote, ShoppingCart, Scale, PlusCircle, QrCode, Trash2, Lock, CreditCard, FileText, Bell, ExternalLink, Terminal, ShieldCheck } from 'lucide-react';

export default function HelpScreen({ onBack }) {
  const manualItems = [
    {
      icon: <Banknote size={24} className="text-blue-500" />,
      title: '1. Cómo abrir la caja',
      desc: 'Al iniciar tu jornada, dirígete a la sección Ventas > Cobrar. El sistema te pedirá ingresar el monto de "Caja Inicial" (el cambio con el que empiezas el día). Ingresa el monto y haz clic en "Abrir Turno" para habilitar el panel de ventas.'
    },
    {
      icon: <ShoppingCart size={24} className="text-green-500" />,
      title: '2. Cómo realizar una venta',
      desc: 'Dentro del panel de ventas, escanea el código de barras del producto o búscalo por nombre en la barra superior. El producto se agregará al carrito lateral. Haz clic en el botón verde COBRAR, selecciona el Medio de Pago (Efectivo, Transferencia, o QR/Tarjeta) y confirma la operación para emitir el ticket.'
    },
    {
      icon: <Scale size={24} className="text-orange-500" />,
      title: '3. Vender productos por peso (ej: 0.500 kg)',
      desc: 'Agrega el producto al carrito (por ejemplo, Granola Artesanal). En el carrito, usa el cuadro de cantidad para escribir el peso exacto utilizando un punto para los decimales (ejemplo: 0.500 para medio kilo). El sistema calculará automáticamente el precio proporcional.'
    },
    {
      icon: <PlusCircle size={24} className="text-purple-500" />,
      title: '4. Cargar un producto manualmente y asignar referencias',
      desc: 'Para productos de fábrica (con código de barras): Escribí el nombre del artículo, hacé clic en el campo "Código de barras o PLU" y pasá el lector de barras sobre el envase. Completá el precio, el stock y presioná "Guardar Producto".\n\nPara productos sueltos o de elaboración propia (sin código): Escribí el nombre del artículo y simplemente marcá la opción "Generar código interno". El sistema le asignará automáticamente un número corto y secuencial (ej. 1, 2, 3). Así, al momento de cobrar, solo tecleás ese número rápido sin tener que inventar códigos complejos.'
    },
    {
      icon: <QrCode size={24} className="text-indigo-500" />,
      title: '5. Vincular celular para cargar inventario con QR',
      desc: 'En la sección Productos, haz clic en el botón Vincular lector QR. Se abrirá un código en la pantalla; escanéalo con la cámara de tu celular. Tu teléfono se convertirá instantáneamente en un escáner de códigos de barras conectado a tu cuenta para cargar stock rápidamente.'
    },
    {
      icon: <Trash2 size={24} className="text-red-500" />,
      title: '6. Eliminar uno o varios productos',
      desc: 'Desde la lista de Productos, haz clic en el ícono del tacho de basura ubicado a la derecha de cualquier ítem para eliminarlo individualmente. Para borrar varios al mismo tiempo, marca las casillas cuadradas (checkbox) a la izquierda de cada producto y presiona el botón de eliminar selección.'
    },
    {
      icon: <Lock size={24} className="text-gray-600" />,
      title: '7. Proteger secciones con clave (Acceso Admin)',
      desc: 'Para evitar que empleados modifiquen precios o configuraciones, ve a Configuración > Seguridad. Activa la opción "Bloqueo por PIN" y establece una clave de 4 dígitos. Aplica esta restricción a las pestañas de Productos y Configuración. Cuando un cajero intente entrar, el sistema le exigirá el PIN.'
    },
    {
      icon: <CreditCard size={24} className="text-blue-600" />,
      title: '8. Vincular Mercado Pago',
      desc: 'Dirígete a Configuración y haz clic en "Conectar con Mercado Pago". Completa la autorización en la ventana oficial y el sistema quedará listo para cobrar con QR automáticamente.'
    },
    {
      icon: <FileText size={24} className="text-cyan-600" />,
      title: '9. Configurar facturación electrónica (ARCA/AFIP)',
      desc: 'En Configuración > Facturación ARCA, carga los datos fiscales de tu comercio: CUIT, Número de Punto de Venta, y sube los archivos de tus certificados digitales (.crt y .key). Una vez guardado, aparecerá la opción de emitir Factura C o B al cobrar.'
    },
    {
      icon: <Bell size={24} className="text-yellow-600" />,
      title: '10. Activar alerta de stock bajo',
      desc: 'Ve a Configuración > Alertas de Inventario. Activa el interruptor de "Notificar stock bajo" y define la cantidad mínima (por ejemplo, 5 unidades). El sistema te avisará cuando un producto alcance ese límite.'
    }
  ];

  const mpSteps = [
    {
      title: "Acceso",
      text: "Dirígete al menú \"Configuración\" en el panel lateral de la aplicación.",
      icon: <ExternalLink size={20} className="text-blue-500" />
    },
    {
      title: "Vincular Cuenta",
      text: "Busca la sección de Mercado Pago y haz clic en el botón azul \"Conectar con Mercado Pago\".",
      icon: <CreditCard size={20} className="text-blue-500" />
    },
    {
      title: "Autorización",
      text: "Se abrirá una ventana oficial de Mercado Pago. Inicia sesión si es necesario y haz clic en \"Autorizar\" o \"Permitir\" para vincular los sistemas.",
      icon: <ShieldCheck size={20} className="text-blue-500" />
    },
    {
      title: "Confirmación",
      text: "Una vez completado, volverás automáticamente a PuntoGestión y verás un cartel verde que dice \"Cuenta Conectada\".",
      icon: <Terminal size={20} className="text-blue-500" />
    }
  ];

  return (
    <div className="screen help-screen-v2">
      <div className="screen-header">
        <div>
          <p className="eyebrow">SOPORTE</p>
          <h2>Manual de Usuario</h2>
          <p className="off-hint">Guía rápida para dominar PuntoGestión paso a paso.</p>
        </div>
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft size={17} /> Volver al panel
        </button>
      </div>

      <div className="help-scroll-container px-6 pb-20">
        <div className="max-w-4xl mx-auto grid gap-6 mt-8">
          {manualItems.map((item, index) => (
            <article key={index} className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex gap-5 items-start">
              <div className="p-3 bg-gray-50 rounded-lg shrink-0">
                {item.icon}
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">{item.title}</h3>
                <p className="text-gray-600 leading-relaxed text-sm md:text-base">
                  {item.desc}
                </p>
              </div>
            </article>
          ))}
        </div>

        {/* Nueva sección: Guía Mercado Pago */}
        <div className="max-w-4xl mx-auto mt-16 mb-12 border-t border-gray-200 pt-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Instrucciones para la Conexión de Mercado Pago</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Sigue esta guía paso a paso para vincular tu cuenta y comenzar a cobrar con QR dinámico.
            </p>
          </div>

          {/* Nota Importante */}
          <div className="bg-amber-50 border-l-4 border-amber-500 p-6 mb-12 rounded-r-xl shadow-sm">
            <div className="flex gap-3">
              <ShieldCheck className="text-amber-600 shrink-0" size={24} />
              <div>
                <h4 className="text-amber-800 font-bold mb-1">Nota Importante</h4>
                <p className="text-amber-700 leading-relaxed">
                  El cobro mediante código QR solo puede ser escaneado y pagado utilizando la aplicación oficial de Mercado Pago.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-12">
            {mpSteps.map((step, index) => (
              <section key={index} className="relative flex flex-col md:flex-row gap-6 items-start">
                <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold shadow-lg z-10">
                  {index + 1}
                </div>

                <div className="flex-1 w-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                      {step.icon}
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">{step.title}</h3>
                  </div>

                  <p className="text-gray-600 text-lg leading-relaxed border-l-4 border-blue-500 pl-4 bg-blue-50/30 py-3 rounded-r-lg">
                    {step.text}
                  </p>
                </div>
              </section>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}


