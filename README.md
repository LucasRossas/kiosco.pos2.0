# Punto Mercado POS

## Firebase

El proyecto funciona sin credenciales usando `localStorage`. Para conectar Firebase:

1. Crear un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Activar **Authentication > Sign-in method > Email/Password**.
3. Crear una base de datos **Firestore**.
4. Copiar `.env.example` como `.env.local` y completar la configuración de la aplicación web de Firebase.
5. Reiniciar Vite con `npm run dev`.

Las variables esperadas son:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Firestore usa persistencia local con `persistentLocalCache` y `persistentMultipleTabManager`. Los datos se guardan por comercio bajo `tenants/{tenantId}`. Publicá `firestore.rules` desde Firebase CLI o copiá su contenido en la pestaña Rules de Firestore.

Sin configuración Firebase, el MVP conserva el comportamiento local y guarda datos separados por tenant en `localStorage`.
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
