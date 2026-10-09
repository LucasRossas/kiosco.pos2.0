import React, { useState } from 'react';
import { getFirebaseAuth } from '../services/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Fingerprint, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ForgotPasswordScreen({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const auth = getFirebaseAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      // Enviamos el correo de recuperación directamente a través de Firebase Auth
      await sendPasswordResetEmail(auth, email.trim());

      setMessage({
        type: 'success',
        text: '¡Enlace enviado! Revisa tu bandeja de entrada para restablecer tu contraseña.'
      });

    } catch (error) {
      console.error("Error en ForgotPassword:", error);
      let errorMessage = 'Ocurrió un error al procesar la solicitud. Intenta de nuevo más tarde.';

      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No se encontró ninguna cuenta con este correo electrónico.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'El formato del correo electrónico no es válido.';
      }

      setMessage({
        type: 'error',
        text: errorMessage
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="shift-page">
      <div className="shift-card">
        <button
          className="btn-ghost back-button"
          onClick={onBackToLogin}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', padding: 0 }}
        >
          <ArrowLeft size={18} />
          Volver al inicio de sesión
        </button>

        <div className="shift-icon">
          <Fingerprint size={28} />
        </div>

        <p className="eyebrow">SEGURIDAD</p>
        <h1 className="shift-title">Recuperar Acceso</h1>
        <p className="shift-description">
          Ingresa el correo electrónico asociado a tu cuenta para recibir un enlace de recuperación.
        </p>

        <form onSubmit={handleSubmit} className="shift-form">
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '13px', color: '#334e68' }}>
              Correo Electrónico
            </label>
            <div className="barcode-row">
              <input
                type="email"
                placeholder="ejemplo@comercio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || message.type === 'success'}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #bcccdc' }}
              />
            </div>
          </div>

          {message.text && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                background: message.type === 'error' ? '#fef2f2' : '#f0fdf4',
                color: message.type === 'error' ? '#991b1b' : '#166534',
                fontSize: '14px',
                marginBottom: '16px',
                border: `1px solid ${message.type === 'error' ? '#fee2e2' : '#dcfce7'}`
              }}
            >
              {message.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
              {message.text}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary btn-large"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
            disabled={loading || message.type === 'success'}
          >
            {loading ? (
              <>
                <Loader2 className="spinner" size={18} />
                Enviando enlace...
              </>
            ) : (
              'Enviar enlace de recuperación'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
