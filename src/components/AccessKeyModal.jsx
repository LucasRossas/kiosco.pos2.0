import React, { useState, useEffect } from 'react';
import { KeyRound, X, Loader2 } from 'lucide-react';

export default function AccessKeyModal({ title, onConfirm, onClose }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lockoutTime, setLockoutTime] = useState(0);

  useEffect(() => {
    let timer;
    if (lockoutTime > 0) {
      timer = setInterval(() => {
        setLockoutTime(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [lockoutTime]);

  const submit = async (event) => {
    event.preventDefault();
    if (lockoutTime > 0) return;

    setIsLoading(true);
    try {
      const result = await onConfirm(key);
      if (result && result.error) {
        setError(result.message || 'La clave no es válida.');
        setKey('');
        if (result.lockout) {
          setLockoutTime(30);
        }
      }
    } catch (err) {
      setError('Error al verificar la clave.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal-content access-key-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div><KeyRound size={22} /><h3>{title}</h3></div>
          <button type="button" className="btn-icon" onClick={onClose} title="Cerrar"><X size={20} /></button>
        </div>
        <p className="off-hint">Ingresá la clave para acceder a las herramientas administrativas.</p>
        <input
          autoFocus
          required
          disabled={isLoading || lockoutTime > 0}
          type="password"
          value={key}
          onChange={(event) => { setKey(event.target.value); setError(''); }}
          placeholder={lockoutTime > 0 ? `Bloqueado (${lockoutTime}s)` : "Clave administrativa"}
        />
        {error && <p className="login-error">{error}</p>}
        <button
          className="btn-primary"
          type="submit"
          disabled={isLoading || lockoutTime > 0}
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : 'Desbloquear acceso'}
        </button>
      </form>
    </div>
  );
}
