import React, { useState, useEffect } from 'react';
import { getFirebaseAuth } from '../services/firebase';
import { confirmPasswordReset, verifyPasswordResetCode, signOut } from 'firebase/auth';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function ResetPasswordScreen() {
  const [passwords, setPasswords] = useState({ new: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('verifying'); // verifying, form, success, error
  const [message, setMessage] = useState('');
  const [oobCode, setOobCode] = useState(null);

  const auth = getFirebaseAuth();

  useEffect(() => {
    // 1. Forzar cierre de sesión para evitar que el usuario tenga acceso a la plataforma
    // mientras está en este flujo de recuperación.
    if (auth.currentUser) {
      signOut(auth).catch(err => console.error("Error al cerrar sesión previa:", err));
    }

    // 2. Extraer el oobCode de la URL (?oobCode=...)
    const params = new URLSearchParams(window.location.search);
    const code = params.get('oobCode');

    if (!code) {
      // La URL es una fuente externa; reflejamos su estado en la pantalla.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      setMessage('El enlace de recuperación es inválido o ha expirado.');
      return;
    }

    setOobCode(code);

    // Verificar si el código es válido antes de mostrar el formulario
    verifyPasswordResetCode(auth, code)
      .then(() => setStatus('form'))
      .catch((err) => {
        console.error("Error verificando código:", err);
        setStatus('error');
        setMessage('El enlace ha expirado o ya fue utilizado.');
      });
  }, [auth]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (passwords.new.length < 6) {
      setMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      setMessage('Las contraseñas no coinciden.');
      return;
    }

    setStatus('loading');
    try {
      await confirmPasswordReset(auth, oobCode, passwords.new);

      // IMPORTANTE: Forzamos el cierre de sesión tras el cambio por seguridad
      await signOut(auth);

      setStatus('success');

      // Limpiar la URL técnica después de unos segundos o al confirmar
      // para que el enrutador de App.jsx vuelva a la normalidad
    } catch (err) {
      console.error("Error restableciendo contraseña:", err);
      setStatus('error');
      setMessage('No se pudo restablecer la contraseña. Inténtalo de nuevo.');
    }
  };

  const handleGoToLogin = () => {
    // Limpiamos la URL técnica y volvemos al home
    window.location.href = window.location.origin + '?login=1';
  };

  if (status === 'verifying') {
    return <div className="auth-loading"><div className="auth-spinner" /><p>Verificando enlace...</p></div>;
  }

  return (
    <div className="shift-page">
      <div className="shift-card">
        <div className="shift-icon">
          {status === 'success' ? <CheckCircle2 size={28} className="text-green-500" /> : <Lock size={28} />}
        </div>

        <p className="eyebrow">SEGURIDAD</p>
        <h1 className="shift-title">
          {status === 'success' ? '¡Contraseña Actualizada!' : 'Nueva Contraseña'}
        </h1>

        {status === 'success' ? (
          <div className="text-center">
            <p className="shift-description" style={{ marginBottom: '24px' }}>
              Tu contraseña ha sido restablecida con éxito. Por seguridad, ingresa nuevamente con tus nuevas credenciales.
            </p>
            <button
              onClick={handleGoToLogin}
              className="btn-primary btn-large w-full"
            >
              Ir al Inicio de Sesión
            </button>
          </div>
        ) : (
          <>
            <p className="shift-description">
              Establece una contraseña segura para proteger el acceso a tu Punto de Venta.
            </p>

            <form onSubmit={handleSubmit} className="shift-form">
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Nueva Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={passwords.new}
                    onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                    placeholder="Mínimo 6 caracteres"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-3 text-slate-400"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Confirmar Contraseña
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                  placeholder="Repite tu contraseña"
                  required
                />
              </div>

              {message && (
                <div className={`p-3 rounded-lg flex gap-2 items-center text-sm mb-4 ${status === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                  <AlertCircle size={16} />
                  {message}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary btn-large w-full flex justify-center items-center gap-2"
                disabled={status === 'loading'}
              >
                {status === 'loading' ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  'Restablecer Contraseña'
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
