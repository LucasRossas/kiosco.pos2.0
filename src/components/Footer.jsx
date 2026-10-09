import React, { useState } from 'react';
import { Store, ExternalLink, Copy, Check, Mail } from 'lucide-react';

export default function Footer({ onNavigateTerms, onNavigatePrivacy }) {
  const [copied, setCopied] = useState(false);
  const supportEmail = "lr.development.code@gmail.com";

  const handleCopy = () => {
    navigator.clipboard.writeText(supportEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const subject = "Consulta de Soporte - PuntoGestión";
  const body = "Hola equipo de PuntoGestión,%0D%0A%0D%0ATengo la siguiente consulta o problema en mi local:%0D%0A[Escribe tu consulta aquí]%0D%0A%0D%0AGracias.";
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${supportEmail}&su=${encodeURIComponent(subject)}&body=${body}`;
  const outlookUrl = `https://outlook.office.com/mail/deeplink/compose?to=${supportEmail}&subject=${encodeURIComponent(subject)}&body=${body}`;
  const mailtoUrl = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${body}`;

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-section">
          <div className="footer-brand">
            <Store size={22} />
            <strong>PuntoGestión</strong>
          </div>
          <p className="footer-tagline">Simplificando la operación de comercios reales.</p>
        </div>

        <div className="footer-section">
          <h4>Legal</h4>
          <nav className="footer-links">
            <button className="btn-link-legal" onClick={onNavigateTerms}>Términos y Condiciones</button>
            <button className="btn-link-legal" onClick={onNavigatePrivacy}>Políticas de Privacidad</button>
          </nav>
        </div>

        <div className="footer-section">
          <h4>Soporte Técnico</h4>
          <div className="flex flex-col items-start gap-4 mt-4">
            {/* Botón Gmail */}
            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-all text-sm border border-blue-400/30 shadow-lg shadow-blue-900/20 active:scale-95"
            >
              <ExternalLink size={16} />
              Redactar en Gmail
            </a>

            {/* Botón Outlook */}
            <a
              href={outlookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded-xl transition-all text-sm border border-sky-400/30 shadow-lg shadow-sky-900/20 active:scale-95"
            >
              <ExternalLink size={16} />
              Redactar en Outlook
            </a>

            {/* Botón Otros (App de Correo) */}
            <a
              href={mailtoUrl}
              className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-4 rounded-xl transition-all text-sm border border-slate-700 shadow-lg active:scale-95"
            >
              <Mail size={16} />
              Otros / App de Correo
            </a>

            {/* Separador y Copiado */}
            <div className="flex flex-col gap-2 w-full">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em]">O copiá nuestra dirección</span>
              <div className="flex items-center gap-2 bg-slate-900 p-2 pl-3 rounded-lg border border-slate-800 w-full group shadow-sm">
                <span className="flex-1 text-[11px] text-white font-bold truncate select-all">{supportEmail}</span>
                <button
                  onClick={handleCopy}
                  className={`p-2 rounded-md transition-all ${
                    copied ? 'bg-green-500/20 text-green-400' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                  title="Copiar email"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-section branding">
          <span>Desarrollado por:</span>
          <img
            src="/logo-lrdevs.jpg"
            alt="LR Development"
            className="dev-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.innerHTML += '<span class="dev-name">LR Development</span>';
            }}
          />
        </div>
      </div>
      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} PuntoGestión. Todos los derechos reservados.</p>
      </div>
    </footer>
  );
}
