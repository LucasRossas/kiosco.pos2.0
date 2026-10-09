import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Store } from 'lucide-react';
import ForgotPasswordScreen from '../components/ForgotPasswordScreen';

export default function LoginScreen({ storeName, onBack, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLogged, setKeepLogged] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);

  if (isRecovering) {
    return <ForgotPasswordScreen onBackToLogin={() => setIsRecovering(false)} />;
  }

  const submit = (event) => {
    event.preventDefault();
    setIsLoading(true);
    Promise.resolve(onLogin({ email, password, keepLogged }))
      .then((result) => {
        if (!result?.ok) setError(result?.message || 'El email o la clave ingresada no son válidos.');
      })
      .finally(() => setIsLoading(false));
  };

  return (
    <div className="shift-page login-page">
      <div className="shift-card login-card">
        <button className="btn-ghost back-button" onClick={onBack}><ArrowLeft size={17} /> Volver al inicio</button>
        <div className="shift-icon"><Store size={27} /></div>
        <p className="eyebrow">ACCESO AL COMERCIO</p>
        <h1>{storeName || 'PuntoGestión'}</h1>
        <p className="shift-description">Ingresá a la cuenta general del comercio. Ventas queda disponible para operar y las herramientas administrativas solicitan una clave adicional.</p>
        <form className="settings-form shift-form" onSubmit={submit}>
          <label>Email de la cuenta
            <input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="nombre@comercio.com" />
          </label>
          <label>Clave de la cuenta
            <input autoFocus required type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} placeholder="Ingresá tu clave" />
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <div className="checkbox-field">
              <label htmlFor="keep-logged">Mantener sesión</label>
              <input id="keep-logged" type="checkbox" checked={keepLogged} onChange={(event) => setKeepLogged(event.target.checked)} />
            </div>

            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: '13px', padding: 0, minHeight: 'auto', height: 'auto', color: '#2563eb', fontWeight: '600' }}
              onClick={() => setIsRecovering(true)}
            >
              ¿Olvidaste tu clave?
            </button>
          </div>

          {error && <p className="login-error"><KeyRound size={15} /> {error}</p>}
          <button className="btn-primary" type="submit" disabled={isLoading}>{isLoading ? 'Ingresando...' : 'Ingresar'}</button>
        </form>
      </div>
    </div>
  );
}
