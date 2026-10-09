import React from 'react';
import { ArrowLeft } from 'lucide-react';

export default function TermsScreen({ onBack }) {
  return (
    <div className="legal-container">
      <header className="legal-header">
        <button onClick={onBack} className="btn-back-legal">
          <ArrowLeft size={20} /> Volver al inicio
        </button>
      </header>
      <article className="legal-content">
        <h1>Términos y Condiciones</h1>
        <p className="legal-update">Última actualización: Septiembre 2026</p>

        <section>
          <h2>1. Aceptación y Registro</h2>
          <p>Al registrarse y utilizar PuntoGestión, el usuario acepta someterse a estos Términos y Condiciones. El usuario se compromete a proveer información verdadera, exacta y actualizada durante el registro, incluyendo nombre completo, DNI, correo electrónico y dirección física del local. El falseamiento de esta información puede derivar en la suspensión inmediata de la cuenta.</p>
        </section>

        <section>
          <h2>2. Descripción del Servicio</h2>
          <p>PuntoGestión provee un software en la nube (SaaS) para la administración de comercios, control de stock y registro de ventas.</p>
        </section>

        <section>
          <h2>3. Uso de Integraciones de Terceros</h2>
          <div className="legal-subsection">
            <h3>Mercado Pago</h3>
            <p>El sistema facilita la conexión para cobros mediante código QR. PuntoGestión no retiene ni administra fondos, y no se responsabiliza por comisiones, retenciones fiscales, o interrupciones del servicio de Mercado Pago.</p>
          </div>
          <div className="legal-subsection">
            <h3>Facturación (ARCA/AFIP)</h3>
            <p>El usuario es el único responsable legal, civil y tributario de los comprobantes emitidos desde la plataforma utilizando su DNI/CUIT. PuntoGestión actúa como intermediario tecnológico y no asume responsabilidad por errores en la carga de certificados digitales o evasión impositiva.</p>
          </div>
        </section>

        <section>
          <h2>4. Responsabilidad de la Cuenta</h2>
          <p>El usuario titular es responsable de mantener la confidencialidad de su contraseña y de todas las acciones realizadas por empleados o terceros desde su cuenta.</p>
        </section>

        <section>
          <h2>5. Disponibilidad del Servicio</h2>
          <p>PuntoGestión se aloja en servidores de alta disponibilidad, pero no garantiza un servicio libre de interrupciones o errores imprevistos. No nos hace responsable por lucro cesante.</p>
        </section>

        <section>
          <h2>6. Jurisdicción</h2>
          <p>Cualquier disputa legal será sometida a la jurisdicción de los tribunales ordinarios de la ciudad de San Luis, República Argentina.</p>
        </section>

        <section>
          <h2>7. Contacto</h2>
          <p>Para consultas, escribinos a: <strong>lr.development.code@gmail.com</strong>.</p>
        </section>
      </article>
    </div>
  );
}
