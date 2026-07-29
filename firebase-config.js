// ═══════════════════════════════════════════════════════════
// firebase-config.js
// Punto ÚNICO de conexión con Firebase para todo el CRM.
// Ningún otro archivo debe inicializar Firebase: todos
// importan { auth, db } desde aquí.
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Configuración del proyecto crm-famocdepanel (ya lista, no cambiar).
const firebaseConfig = {
  apiKey: "AIzaSyCpzhw654i0mkTE1Z2D8Z_01_2Ki0oIQ-o",
  authDomain: "crm-famocdepanel.firebaseapp.com",
  projectId: "crm-famocdepanel",
  storageBucket: "crm-famocdepanel.firebasestorage.app",
  messagingSenderId: "665570344705",
  appId: "1:665570344705:web:49c38333d89150311d6500"
};

// Inicialización (esto solo ocurre una vez en toda la app)
const app = initializeApp(firebaseConfig);

// Servicios que exportamos al resto del CRM:
export const auth = getAuth(app);      // Autenticación (login/logout)
export const db = getFirestore(app);   // Base de datos Cloud Firestore

// Nota: es normal y seguro que la apiKey sea visible en el navegador.
// La apiKey de Firebase solo IDENTIFICA el proyecto, no da permisos.
// Los permisos reales los controlan las reglas de Firestore (firestore.rules).
