// ═══════════════════════════════════════════════════════════
// app.js — Fase 3 completa
// Controlador del shell del CRM Famocdepanel.
//   1. Muestra login o aplicación según la sesión (auth-service)
//   2. Pinta la barra de navegación con el usuario y su rol
//   3. Cambia entre las vistas Pipeline y Agenda
//   4. Arranca/detiene los módulos completos de cada vista
// ═══════════════════════════════════════════════════════════

import { iniciarSesion, cerrarSesion, observarSesion, esAdmin } from "./auth-service.js";
import { iniciarPipeline, detenerPipeline } from "./pipeline-view.js";
import { iniciarAgenda, detenerAgenda } from "./agenda-view.js";

// ───────────────────────────────────────────────
// Referencias a elementos de la página
// ───────────────────────────────────────────────
const pantallaLogin = document.getElementById("login-screen");
const app           = document.getElementById("app");
const btnLogin      = document.getElementById("login-btn");
const errorLbl      = document.getElementById("login-error");

// ───────────────────────────────────────────────
// 1. SESIÓN: decide qué se ve
// ───────────────────────────────────────────────
observarSesion((usuario, mensajeError) => {
  if (usuario) {
    pantallaLogin.classList.add("oculto");
    app.classList.add("visible");
    iniciarShell(usuario);
  } else {
    detenerPipeline();
    detenerAgenda();
    app.classList.remove("visible");
    pantallaLogin.classList.remove("oculto");
    if (mensajeError) errorLbl.textContent = mensajeError;
  }
});

// ───────────────────────────────────────────────
// 2. LOGIN
// ───────────────────────────────────────────────
async function manejarLogin() {
  errorLbl.textContent = "";
  btnLogin.disabled = true;
  btnLogin.textContent = "Verificando...";

  const email = document.getElementById("login-email").value.trim();
  const pwd = document.getElementById("login-pwd").value;
  const res = await iniciarSesion(email, pwd);

  btnLogin.disabled = false;
  btnLogin.textContent = "Iniciar sesión";
  if (!res.ok) errorLbl.textContent = res.mensaje;
}

btnLogin.addEventListener("click", manejarLogin);
document.getElementById("login-pwd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") manejarLogin();
});
document.getElementById("login-email").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login-pwd").focus();
});

// ───────────────────────────────────────────────
// 3. SHELL: nav con usuario/rol + arranque de módulos
// ───────────────────────────────────────────────
function iniciarShell(usuario) {
  pintarNavUsuario(usuario);
  iniciarPipeline();
  iniciarAgenda();
}

function pintarNavUsuario(usuario) {
  const navRight = document.getElementById("nav-right");
  const nombre = usuario.nombreRep || usuario.email;
  const iniciales = nombre.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  const esGerencia = esAdmin();

  navRight.innerHTML = `
    <div class="user-badge">
      <div class="user-avatar">${iniciales}</div>
      <span class="user-name">${nombre}</span>
      <span class="user-role-badge ${esGerencia ? "role-gerencia" : "role-rep"}">
        ${esGerencia ? "Gerencia" : "Rep"}
      </span>
    </div>
    <button class="btn-logout" id="btn-logout">Salir</button>
  `;
  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);
}

// ───────────────────────────────────────────────
// 4. NAVEGACIÓN ENTRE TABS
// ───────────────────────────────────────────────
const tabs = {
  pipeline: { boton: document.getElementById("tab-pipeline"), pagina: document.getElementById("page-pipeline") },
  agenda:   { boton: document.getElementById("tab-agenda"),   pagina: document.getElementById("page-agenda") }
};

function mostrarTab(nombre) {
  Object.entries(tabs).forEach(([clave, t]) => {
    t.boton.classList.toggle("active", clave === nombre);
    t.pagina.classList.toggle("active", clave === nombre);
  });
}

tabs.pipeline.boton.addEventListener("click", () => mostrarTab("pipeline"));
tabs.agenda.boton.addEventListener("click", () => mostrarTab("agenda"));
