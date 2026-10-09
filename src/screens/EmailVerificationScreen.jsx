import React, { useState } from 'react';
import { CheckCircle2, Mail, RefreshCw, LogOut } from 'lucide-react';

export default function EmailVerificationScreen({ email, onCheck, onResend, onLogout }) {
  const [message, setMessage] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const checkVerification = async () => {
    setIsChecking(true);
    const verified = await onCheck();
    setMessage(verified ? 'Correo verificado. Continuando...' : 'Todavía no figura como verificado. Revisá tu bandeja de entrada.');
    setIsChecking(false);
  };

  const resendVerification = async () => {
    setIsResending(true);
    try {
      await onResend();
      setMessage('Te enviamos un nuevo correo de verificación. Revisá también Spam o Promociones.');
    } catch (error) {
      const messages = {
        'auth/too-many-requests': 'Se solicitaron demasiados correos. Esperá unos minutos antes de volver a intentar.',
        'auth/network-request-failed': 'No hay conexión con Firebase. Revisá tu conexión a internet.',
        'auth/no-current-user': 'La sesión de Firebase expiró. Volvé a ingresar para solicitar otro correo.',
      };
      setMessage(messages[error.code] || `Firebase no pudo enviar el correo (${error.code || 'error desconocido'}).`);
    }
    setIsResending(false);
  };

  return (
    <div className="shift-page verification-page">
      <div className="shift-card verification-card">
        <div className="shift-icon"><Mail size={28} /></div>
        <p className="eyebrow">VERIFICACIÓN DE CUENTA</p>
        <h1>Verificá tu correo electrónico para continuar con la activación</h1>
        <p className="shift-description">Enviamos un enlace a <strong>{email}</strong>. Confirmá tu dirección y luego volvé a esta pantalla.</p>
        {message && <p className="verification-message"><CheckCircle2 size={16} /> {message}</p>}
        <button className="btn-primary" onClick={checkVerification} disabled={isChecking}>{isChecking ? 'Verificando...' : 'Ya verifiqué mi correo'}</button>
        <button className="btn-secondary verification-resend" onClick={resendVerification} disabled={isResending}><RefreshCw size={16} /> {isResending ? 'Enviando...' : 'Reenviar correo'}</button>
        <button className="btn-ghost" onClick={onLogout}><LogOut size={16} /> Cerrar sesión</button>
      </div>
    </div>
  );
}
