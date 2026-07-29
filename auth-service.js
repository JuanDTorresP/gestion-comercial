// ═══════════════════════════════════════════════════════════
// auth-service.js
// Toda la lógica de sesión y roles del CRM vive aquí.
// Las vistas (pipeline, agenda, formulario) NUNCA hablan con
// Firebase Auth directamente: usan estas funciones.
//
// Funciones que exporta:
//   iniciarSesion(email, password)  → inicia sesión
//   cerrarSesion()                  → cierra sesión
//   observarSesion(callback)        → avisa cuando alguien entra/sale
//   obtenerUsuario()                → devuelve el usuario actual con su rol
// ═══════════════════════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Usuario en sesión, con su perfil ya cargado desde Firestore.
// Estructura: { uid, email, rol, nombreRep }
let usuarioActual = null;

// ───────────────────────────────────────────────
// 1. INICIAR SESIÓN
// Recibe email y contraseña, y se los entrega a Firebase Auth.
// Firebase verifica la contraseña en SUS servidores: la contraseña
// nunca se guarda ni se compara en nuestro código.
// ───────────────────────────────────────────────
export async function iniciarSesion(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // No hace falta hacer nada más aquí: observarSesion() detecta
    // el login automáticamente y carga el perfil.
    return { ok: true };
  } catch (error) {
    return { ok: false, mensaje: traducirError(error.code) };
  }
}

// ───────────────────────────────────────────────
// 2. CERRAR SESIÓN
// ───────────────────────────────────────────────
export async function cerrarSesion() {
  usuarioActual = null;
  await signOut(auth);
}

// ───────────────────────────────────────────────
// 3. OBSERVADOR DE SESIÓN (el corazón del sistema)
// Se llama UNA vez al arrancar la app. Firebase invoca el callback:
//   - al cargar la página (si había sesión guardada, la restaura)
//   - cuando alguien inicia sesión
//   - cuando alguien cierra sesión
//
// Cuando hay sesión, este módulo va a Firestore, lee el documento
// usuarios/{uid} y de ahí obtiene el ROL. El rol NUNCA se guarda en
// sessionStorage ni lo decide el navegador: viene de la base de datos
// y las reglas de Firestore lo vuelven a verificar en cada operación.
//
// Uso:
//   observarSesion(function(usuario) {
//     if (usuario) { /* mostrar la app según usuario.rol */ }
//     else         { /* mostrar pantalla de login */ }
//   });
// ───────────────────────────────────────────────
export function observarSesion(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Nadie ha iniciado sesión
      usuarioActual = null;
      callback(null);
      return;
    }

    // Hay sesión: buscamos su perfil (rol + nombre) en Firestore
    try {
      const perfilSnap = await getDoc(doc(db, "usuarios", user.uid));

      if (!perfilSnap.exists()) {
        // El usuario existe en Auth pero nadie le creó su perfil
        // en la colección "usuarios". Sin perfil no hay rol → fuera.
        console.error(
          "El usuario " + user.email + " no tiene documento en la " +
          "colección 'usuarios'. Créalo en Firestore con su UID: " + user.uid
        );
        await signOut(auth);
        callback(null, "Tu cuenta no tiene un perfil asignado. Contacta al administrador.");
        return;
      }

      const perfil = perfilSnap.data();
      usuarioActual = {
        uid: user.uid,
        email: user.email,
        rol: perfil.rol,             // "admin" o "vendedor"
        nombreRep: perfil.nombreRep || null  // ej: "Patricia Lopera"
      };
      callback(usuarioActual);
    } catch (e) {
      console.error("Error leyendo el perfil del usuario:", e);
      callback(null, "No se pudo cargar tu perfil. Intenta de nuevo.");
    }
  });
}

// ───────────────────────────────────────────────
// 4. USUARIO ACTUAL
// Cualquier módulo puede preguntar quién está en sesión.
// ───────────────────────────────────────────────
export function obtenerUsuario() {
  return usuarioActual;
}

// Atajos de conveniencia para las vistas:
export function esAdmin() {
  return usuarioActual !== null && usuarioActual.rol === "admin";
}

export function esVendedor() {
  return usuarioActual !== null && usuarioActual.rol === "vendedor";
}

// ───────────────────────────────────────────────
// Traducción de errores de Firebase a mensajes claros en español
// ───────────────────────────────────────────────
function traducirError(codigo) {
  switch (codigo) {
    case "auth/invalid-email":
      return "El correo no tiene un formato válido.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Correo o contraseña incorrectos.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
    case "auth/network-request-failed":
      return "Sin conexión. Verifica tu internet.";
    default:
      return "No se pudo iniciar sesión. Intenta de nuevo.";
  }
}
