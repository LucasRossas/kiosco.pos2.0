import React from 'react';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyScreen({ onBack }) {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <button onClick={onBack} className="btn-back-legal">
          <ArrowLeft size={20} /> Volver al inicio
        </button>
      </header>
      <article className="legal-content">
        <h1>Política de Privacidad</h1>
        <p className="legal-update">Última actualización: Septiembre 2026</p>

        <section>
          <h2>1. Recopilación de Datos</h2>
          <p>Para el alta del servicio, facturación y validación de identidad, recolectamos los siguientes datos del titular: nombre completo, DNI, correo electrónico y dirección del local comercial.</p>
        </section>

        <section>
          <h2>2. Uso de la Información y Catálogo Inteligente</h2>
          <p>Los datos recolectados se utilizan para el funcionamiento de la cuenta y la seguridad del sistema.</p>
          <p><strong>Aclaración sobre el Catálogo Global:</strong> Al ingresar un nuevo producto, el código de barras y el nombre descriptivo podrán integrarse a un catálogo global anónimo para facilitar la autocompletación a otros comercios. Los precios, cantidades en stock, márgenes de ganancia, estadísticas de venta y los datos personales del titular (DNI, nombre, dirección) son estrictamente privados y no se comparten con otros usuarios ni terceros comerciales.</p>
        </section>

        <section>
          <h2>3. Proveedores de Infraestructura</h2>
          <p>La información es procesada y almacenada utilizando servidores seguros de Google (Firebase).</p>
        </section>

        <section>
          <h2>4. Derechos del Usuario</h2>
          <p>Conforme a la Ley N° 25.326 de Protección de Datos Personales de la República Argentina, el usuario titular de los datos (DNI registrado) tiene derecho a solicitar el acceso, rectificación, actualización o eliminación de su información en cualquier momento, enviando un correo a <strong>lr.development.code@gmail.com</strong>.</p>
        </section>
      </article>
    </div>
  );
}
