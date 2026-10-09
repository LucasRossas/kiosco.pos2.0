import React, { useState } from 'react';
import { Store, ArrowLeft, ShieldCheck, User, Lock } from 'lucide-react';
import { createFirebaseAccount, isFirebaseConfigured } from '../services/firebase';

const PROVINCIAS = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos',
  'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro',
  'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'
];

export default function OnboardingScreen({ planElegido, onBackToLogin, onNavigateTerms, onNavigatePrivacy }) {
  const [formData, setFormData] = useState({
    fullName: '',
    dni: '',
    phone: '',
    email: '',
    password: '',
    storeName: '',
    calle: '',
    numero: '',
    localidad: '',
    provincia: 'San Luis'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!isFirebaseConfigured) {
        throw new Error('El sistema de autenticación no está configurado.');
      }

      const accountProfile = {
        fullName: formData.fullName,
        dni: formData.dni,
        phone: formData.phone,
        storeName: formData.storeName,
        direccion: {
          calle: formData.calle,
          numero: formData.numero,
          localidad: formData.localidad,
          provincia: formData.provincia
        },
        plan: planElegido,
        price: planElegido === 'kiosco' ? 50000 : 85000,
        status: 'pending_payment',
        subscriptionStatus: 'pending',
        isActive: false,
        createdAt: new Date().toISOString()
      };

      await createFirebaseAccount({
        email: formData.email,
        password: formData.password,
        profile: accountProfile,
      });

    } catch (err) {
      console.error('Error durante el registro:', err);
      let message = 'No se pudo completar el registro.';
      if (err.code === 'auth/email-already-in-use') message = 'El correo electrónico ya está registrado.';
      else if (err.code === 'auth/invalid-email') message = 'El correo electrónico no es válido.';
      else if (err.code === 'auth/weak-password') message = 'La contraseña debe ser más fuerte (mín. 6 caracteres).';
      else if (err.message) message = err.message;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const planClass = planElegido === 'mercado' ? 'plan-mercado' : 'plan-kiosco';

  return (
    <div className={`onboarding-fullscreen ${planClass}`}>
      <div className="onboarding-side-panel">
        <div className="onboarding-branding">
          <div className="logo-icon"><ShieldCheck size={40} /></div>
          <h1>PuntoGestión</h1>
          <p>Tu comercio, bajo control.</p>
        </div>

        <div className="plan-pill">
          <span>PLAN SELECCIONADO</span>
          <strong>{planElegido?.toUpperCase()}</strong>
        </div>

        <div className="onboarding-quote">
          "La herramienta más potente para la gestión diaria de tu negocio."
        </div>
      </div>

      <div className="onboarding-main-content">
        <div className="onboarding-form-container">
          <button className="btn-back-login" onClick={onBackToLogin}>
            <ArrowLeft size={18} /> Volver al inicio
          </button>

          <header className="onboarding-header">
            <p className="eyebrow">PASO 1 DE 2</p>
            <h2>Crea tu comercio</h2>
            <p className="subtitle">Completa los datos para configurar tu cuenta administrativa.</p>
          </header>

          <form onSubmit={handleSubmit} className="onboarding-grid-form">
            <section className="form-section">
              <h3><User size={16} /> Datos Personales</h3>
              <div className="form-row">
                <div className="field">
                  <label>Nombre Completo</label>
                  <input required name="fullName" value={formData.fullName} onChange={handleChange} placeholder="Ej: Juan Pérez" />
                </div>
                <div className="field">
                  <label>DNI</label>
                  <input required name="dni" value={formData.dni} onChange={handleChange} placeholder="Sin puntos" />
                </div>
              </div>
              <div className="field">
                <label>Teléfono de Contacto</label>
                <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="Cod. área + número" />
              </div>
            </section>

            <section className="form-section">
              <h3><Store size={16} /> Sobre el Comercio</h3>
              <div className="field">
                <label>Nombre del Comercio</label>
                <input required name="storeName" value={formData.storeName} onChange={handleChange} placeholder="Nombre de fantasía" />
              </div>

              <div className="form-row triplet">
                <div className="field grow-2">
                  <label>Calle</label>
                  <input required name="calle" value={formData.calle} onChange={handleChange} placeholder="Ej: Av. Illia" />
                </div>
                <div className="field">
                  <label>Nº</label>
                  <input required name="numero" value={formData.numero} onChange={handleChange} placeholder="123" />
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Localidad</label>
                  <input required name="localidad" value={formData.localidad} onChange={handleChange} placeholder="Ciudad/Pueblo" />
                </div>
                <div className="field">
                  <label>Provincia</label>
                  <select name="provincia" value={formData.provincia} onChange={handleChange}>
                    {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3><Lock size={16} /> Credenciales</h3>
              <div className="field">
                <label>Email de acceso</label>
                <input required type="email" name="email" value={formData.email} onChange={handleChange} placeholder="tu@email.com" />
              </div>
              <div className="field">
                <label>Contraseña</label>
                <input required type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Mínimo 6 caracteres" minLength={6} />
              </div>
            </section>

            {error && <div className="error-banner">{error}</div>}

            <footer className="onboarding-footer">
              <label className="legal-checkbox">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                />
                <span>
                  He leído y acepto los <button type="button" className="btn-inline-legal" onClick={onNavigateTerms}>Términos y Condiciones</button> y las <button type="button" className="btn-inline-legal" onClick={onNavigatePrivacy}>Políticas de Privacidad</button>.
                </span>
              </label>

              <button type="submit" className="btn-execute-onboarding" disabled={loading || !acceptedTerms}>
                {loading ? 'Creando cuenta...' : 'Confirmar y Continuar'}
              </button>
              <p className="terms">PuntoGestión utiliza encriptación de grado bancario para proteger tus datos.</p>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}
