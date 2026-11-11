// ═══════════════════════════════════════════════════════════
// agenda-view.js — v5.3
// v5.3 (nov 2026): OPORTUNIDAD con 3 opciones en vez de texto libre:
//       🔄 Seguimiento (lista de las oportunidades de ESA cuenta en el pipeline),
//       ✨ Nueva oportunidad (se crea en el pipeline) o ⚪ Sin oportunidad
//       (relacionamiento / operativa). Así la oportunidad ya no se escribe a mano.
// v5.2 (nov 2026): SEGMENTO único (Retail / Corporativo / Público) en lugar
//       de Canal + Sector; la misma cuenta escrita distinto ("SAS"/"SA",
//       mayúsculas) es UNA sola (claveCuenta); la oportunidad creada desde
//       una gestión pide canal / origen / broker de las listas cerradas.
// v5.1: abrirGestionParaCuenta() → la ficha de cuenta abre el formulario
//       con la cuenta ya elegida.
// Cambios v5.0 (nov 2026):
//  · FORMULARIO:
//    - Ciudad fija: Bogotá.
//    - Cuenta: se elige una EXISTENTE (buscador) o se REGISTRA una nueva.
//      Tipo de cliente, canal y sector salen solos de la ficha de la cuenta.
//    - Nueva ficha de cuenta (colección `cuentas`): canal, sector
//      (🏛 Público / 💼 Privado) y contactos que el equipo va alimentando.
//    - Contacto de la gestión: se elige de la ficha o se agrega uno nuevo.
//    - Modalidad = Venta / Renta (campo `negocio`). Virtual/Presencial
//      se conserva como "Tipo de reunión" (campo `modalidad`, sin cambios).
//    - Historial de notas de la cuenta dentro del modal.
//  · MÉTRICAS:
//    - Nueva sub-pestaña "📈 Histórico": indicador del mes vs mes anterior,
//      vs promedio del año, ritmo del mes en curso, tabla mes a mes con
//      mapa de calor, rep × mes, y preparado para año fiscal (FY_INICIO_MES).
//    - Reporte mensual: variación vs mes anterior en cada tarjeta y una
//      gráfica de composición (100%) que reemplaza las tres donas.
// Cambios v4.2 (oct 2026) · Sprint de Tracción, Fase 1:
//  · Bloque opcional "🚀 Sprint de Tracción" en el modal de gestión:
//    acción del sprint (ruta, chequeo, invitación FLEX, jornada FLEX,
//    referido), paso de la ruta de 12 días y si hubo decisor.
//  · Campos nuevos en la gestión: sprintAccion, sprintPaso, sprintDecisor.
//    `tipo` (Comercial/Operativo) NO cambia: las gráficas siguen iguales.
//  · Chip "🚀" en la lista de gestiones cuando hay acción del sprint.
//  · v4.3: abrirGestionPorId(): el panel de gestiones de la pestaña
//    Sprint abre aquí una gestión existente para verla o editarla.
//  · abrirGestionDesdeSprint(): la pestaña Sprint abre este modal ya
//    prellenado (cuenta, rep, paso de la ruta) para no escribir a mano
//    el nombre de la cuenta.
// Cambios v4 (oct 2026):
//  · Elizabeth ya no aparece en la agenda (tarjetas, filtros, gráficas,
//    listas). Sus gestiones NO se borran de Firestore: solo se ocultan.
//  · Trazabilidad: si desde una gestión la oportunidad pasa a "Perdido",
//    su valor esperado queda en 0 (misma regla del pipeline v4).
//  · v4.1: si pasa a "Ganado", probabilidad 100% y esperado = 100% del valor.
//  · Las oportunidades creadas desde la agenda quedan con el año de
//    radicación de la fecha de la gestión (para el selector 2026/27/28).
// Novedades de la v3 sobre la v2:
//  · 🗓 Semana: gráfica de gestiones por día + tarjetas clicables
//  · 🔗 TRAZABILIDAD CON EL PIPELINE: una gestión comercial se
//    puede vincular a una oportunidad. Al guardarla:
//      - actualiza el ESTADO de la oportunidad
//      - actualiza el VALOR de la oportunidad
//      - la CUENTA de la oportunidad se mantiene intacta
//    o crea una oportunidad nueva en el pipeline si no existe.
// ═══════════════════════════════════════════════════════════

import { obtenerUsuario, esAdmin } from "./auth-service.js";
import {
  suscribirGestiones, crearGestion, actualizarGestion, eliminarGestion,
  suscribirDeals, crearDeal, actualizarDeal,
  suscribirCuentas, crearCuenta, actualizarCuenta, agregarContactoCuenta, idCuenta,
  suscribirCuentasSprint
} from "./firestore-service.js";
import { ACCIONES_SPRINT, PASOS_RUTA } from "./sprint-config.js";
import {
  SEGMENTOS, SEGMENTO_TXT, CANALES, ORIGENES_DIRECTO, ORIGEN_INDIRECTO,
  segmentoDeRegistro, normSegmento, nombrePreferido, claveCuenta, parecidoCuentas
} from "./catalogos.js";
import { alCambiarCatalogo, brokers as listaBrokers, brokerDe } from "./cuentas-store.js";

// ── Constantes de negocio ──
const REPS_BASE = ["Patricia Lopera", "Clemencia Rodriguez", "Ivan Muñoz", "Johana Mayo"];
// Reps que ya no deben aparecer en la agenda. Se compara por primer nombre,
// sin tildes ni mayúsculas, así cubre "Elizabeth" y "Elizabeth <apellido>".
// Sus gestiones siguen en Firestore; solo se ocultan de todas las vistas.
const REPS_EXCLUIDOS = ["elizabeth"];
function normNombre(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}
// Misma regla del pipeline: Ganado → prob 100% y esperado = valor;
// Perdido → esperado 0; resto → valor × probabilidad.
function probYEsperado(estado, valor, prob) {
  const v = parseFloat(valor) || 0;
  const p = parseFloat(prob) || 0;
  if (estado === "Ganado") return { prob: 1, esperado: Math.round(v) };
  if (estado === "Perdido") return { prob: p, esperado: 0 };
  return { prob: p, esperado: Math.round(v * p) };
}
function esRepExcluido(nombre) {
  const primero = normNombre(nombre).split(/\s+/)[0];
  return REPS_EXCLUIDOS.includes(primero);
}
const ETAPAS = ["Identificado", "Seguimiento", "Cotización", "Diseño", "Negociación"];
const ETAPA_COLORS = { "Identificado": "#2563EB", "Seguimiento": "#7c3aed", "Cotización": "#d97706", "Diseño": "#dc2626", "Negociación": "#16a34a" };
const REP_COLORS = ["#2563EB", "#16a34a", "#7c3aed", "#d97706", "#dc2626", "#0d9488"];
const MESES_NOMBRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
// Ciudad única de operación
const CIUDAD_FIJA = "Bogotá";
// Mes en que arranca el año fiscal (1 = enero → FY = año calendario).
// Si el FY de Famoc arranca en otro mes, cambiar solo este número.
const FY_INICIO_MES = 1;
// Segmento de una gestión (las viejas traen canal + sector: se traducen)
function segDe(g) { return segmentoDeRegistro(g); }
const NEGOCIOS = ["Venta", "Renta"];
// Indicadores del histórico: clave → { etiqueta, cálculo sobre una lista de gestiones }
const INDICADORES = {
  total:   { t: "Gestiones totales",   f: l => l.length },
  com:     { t: "Comerciales",         f: l => l.filter(g => g.tipo === "Comercial").length },
  ope:     { t: "Operativas",          f: l => l.filter(g => g.tipo === "Operativo").length },
  cta:     { t: "Cuentas únicas",      f: l => new Set(l.filter(g => String(g.cuenta || "").trim()).map(g => claveCuenta(g.cuenta))).size },
  nue:     { t: "Clientes nuevos",     f: l => l.filter(g => g.tipoCliente === "Nuevo").length },
  pre:     { t: "Reuniones presenciales", f: l => l.filter(g => g.modalidad === "Presencial").length },
  venta:   { t: "Gestiones de venta",  f: l => l.filter(g => g.negocio === "Venta").length },
  renta:   { t: "Gestiones de renta",  f: l => l.filter(g => g.negocio === "Renta").length },
  pub:     { t: "Segmento público",    f: l => l.filter(g => segDe(g) === "Público").length }
};
const DIAS_NOMBRE = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];

// Estados del PIPELINE y traducción etapa de agenda → estado sugerido
const ESTADOS_PIPE = ["Identificado", "Cotizado", "En diseño", "Negociación", "On hold", "Ganado", "Perdido"];
const MAPA_ETAPA_ESTADO = {
  "Identificado": "Identificado",
  "Seguimiento": "",            // seguimiento no cambia el estado por sí solo
  "Cotización": "Cotizado",
  "Diseño": "En diseño",
  "Negociación": "Negociación"
};

// ── Estado interno ──
let gestiones = [];
let deals = [];
let fichas = [];          // colección `cuentas`
let cuentasSprint = [];   // base instalada (para contactos y existencia)
let parar = null, pararDeals = null, pararFichas = null, pararSprint = null, pararCat = null;
// Estado del bloque de cuenta en el modal
let modoCuenta = "existente";   // "existente" | "nueva"
let cuentaOriginal = "";        // cuenta de la gestión en edición
let tipoClienteOriginal = "";
let histLimite = 8;
// Oportunidad de la gestión: "seg" (seguimiento) | "nueva" | "sin"
let modoOpp = "seg";
let oppLegado = "";   // texto viejo de oportunidad (gestiones sin vínculo al pipeline)
// Histórico
let hisFY = null, hisMes = "", hisInd = "total", hisRep = "";
let editandoId = null;
let charts = {};
let semanaOffset = 0;
let semRep = "", semTipo = "", semMod = "";
let cmpA = "", cmpB = "";
let eqMes = "";
let mesInicializado = false;
const filtros = { texto: "", rep: "", tipo: "", etapa: "", mes: "", tipoCliente: "", segmento: "", modalidad: "", negocio: "" };

// ── Utilidades ──
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function etapaDe(g) { return g.etapaVenta || g.etapa || ""; }
function mesDe(g) { return String(g.fecha || "").slice(0, 7); }
function pad(n) { return String(n).padStart(2, "0"); }
function claveFecha(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nombreMes(clave) {
  if (!clave) return "";
  const [a, m] = clave.split("-");
  return `${MESES_NOMBRE[parseInt(m) - 1]} ${a}`;
}
function fechaLegible(f) {
  if (!f) return "Sin fecha";
  const d = new Date(f + "T00:00:00");
  if (isNaN(d)) return f;
  return d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}
function puedeEditar(g) {
  if (esAdmin()) return true;
  const u = obtenerUsuario();
  return u && g.rep === u.nombreRep;
}
// Base de datos visible según el rol:
// Gerencia ve todo; un vendedor SOLO sus propias gestiones.
function baseGestiones() {
  const visibles = gestiones.filter(g => !esRepExcluido(g.rep));
  if (esAdmin()) return visibles;
  const u = obtenerUsuario();
  return visibles.filter(g => g.rep === u?.nombreRep);
}
// Lista de reps para filtros y tarjetas (sin los excluidos)
function repsVisibles() {
  return [...new Set([...REPS_BASE, ...gestiones.map(g => g.rep).filter(Boolean)])]
    .filter(r => !esRepExcluido(r))
    .sort();
}
function chip(txt, bg, cl) {
  return txt ? `<span class="badge" style="background:${bg};color:${cl}">${esc(txt)}</span>` : "";
}
function mkChart(id, cfg) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const el = $(id);
  if (!el || typeof Chart === "undefined") return;
  charts[id] = new Chart(el, cfg);
}
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function lunesDe(offset) {
  const hoy = new Date();
  const dia = (hoy.getDay() + 6) % 7;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - dia + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}
function itemHtml(g) {
  return `
    <div class="ag-item">
      <span class="ag-hora">${esc(g.hora) || "—"}</span>
      <div class="ag-cuerpo">
        <div class="ag-cuenta">${esc(g.cuenta) || "(sin cuenta)"}
          <span class="ag-rep-tag"> · ${esc(g.rep)}</span></div>
        <div class="ag-opp">${esc(g.oportunidad)}</div>
        <div class="ag-meta">
          ${chip(g.tipo, g.tipo === "Comercial" ? "#EFF6FF" : "#F3F4F6", g.tipo === "Comercial" ? "#1d4ed8" : "#374151")}
          ${chip(etapaDe(g), "#EDE9FE", "#6d28d9")}
          ${chip(g.negocio, g.negocio === "Renta" ? "#E0E7FF" : "#DCFCE7", g.negocio === "Renta" ? "#4338ca" : "#15803d")}
          ${chip(segDe(g) ? SEGMENTO_TXT[segDe(g)] : "", "#F3F4F6", "#374151")}
          ${chip(g.modalidad, "#FEF3C7", "#b45309")}
          ${chip(g.tipoCliente === "Nuevo" ? "✨ Nuevo" : "", "#CCFBF1", "#0f766e")}
          ${chip(g.dealId ? "🔗 Pipeline" : "", "#EFF6FF", "#1d4ed8")}
          ${chip(chipSprint(g), "#FEF3C7", "#92400e")}
          ${g.contactoNombre ? `<span class="ag-ciudad">👤 ${esc(g.contactoNombre)}${g.contactoCargo ? " · " + esc(g.contactoCargo) : ""}</span>` : ""}
          ${g.ciudad && normNombre(g.ciudad) !== normNombre(CIUDAD_FIJA) ? `<span class="ag-ciudad">📍 ${esc(g.ciudad)}</span>` : ""}
        </div>
        ${g.notas ? `<div class="ag-notas">${esc(g.notas)}</div>` : ""}
      </div>
      ${puedeEditar(g) ? `<button class="btn-editar" data-id="${g.id}" title="Editar gestión" aria-label="Editar gestión">✏️</button>` : ""}
    </div>`;
}
// Texto del chip del sprint: "🚀 Día 1 · Llamada · decisor" / "🚀 Jornada FLEX"
function chipSprint(g) {
  const a = ACCIONES_SPRINT[g.sprintAccion];
  if (!a) return "";
  if (g.sprintAccion === "ruta") return "🚀 " + (g.sprintPaso || a.corto) + (g.sprintDecisor ? " · decisor" : "");
  return "🚀 " + a.corto;
}
function activarBotonesEditar(contenedor) {
  contenedor.querySelectorAll(".btn-editar").forEach(btn => {
    btn.addEventListener("click", () => {
      const g = gestiones.find(x => x.id === btn.dataset.id);
      if (g) abrirModal(g);
    });
  });
}

// ═══════════════════════════════════════════
// ARRANQUE / PARADA
// ═══════════════════════════════════════════
export function iniciarAgenda() {
  semanaOffset = 0; semRep = ""; semTipo = ""; semMod = ""; cmpA = ""; cmpB = ""; eqMes = ""; mesInicializado = false;
  hisFY = null; hisMes = ""; hisInd = "total"; hisRep = "";
  Object.keys(filtros).forEach(k => filtros[k] = "");
  pintarEstructura();
  if (parar) parar();
  parar = suscribirGestiones(
    (lista) => { gestiones = lista; actualizarOpcionesFiltros(); refrescarCuentas(); render(); },
    () => {
      $("ag-sub-sem").innerHTML =
        `<div class="estado-conexion error">✕ No se pudo conectar a la Agenda. Revisa tu conexión o tus permisos.</div>`;
    }
  );
  // También escuchamos las oportunidades del pipeline (para la trazabilidad)
  if (pararDeals) pararDeals();
  pararDeals = suscribirDeals(
    (lista) => { deals = lista; poblarSelectDeals(); refrescarCuentas(); },
    () => {}
  );
  // Fichas de cuenta (canal, sector, contactos) y base instalada del sprint
  if (pararFichas) pararFichas();
  pararFichas = suscribirCuentas(
    (lista) => { fichas = lista; refrescarCuentas(); },
    () => { console.warn("No se pudo leer la colección cuentas: revisa las reglas de Firestore."); }
  );
  // Catálogo compartido (brokers para la oportunidad nueva)
  if (pararCat) pararCat();
  pararCat = alCambiarCatalogo(() => {});
  if (pararSprint) pararSprint();
  pararSprint = suscribirCuentasSprint(
    (lista) => { cuentasSprint = lista; refrescarCuentas(); },
    () => {}
  );
}

export function detenerAgenda() {
  if (parar) { parar(); parar = null; }
  if (pararDeals) { pararDeals(); pararDeals = null; }
  if (pararFichas) { pararFichas(); pararFichas = null; }
  if (pararSprint) { pararSprint(); pararSprint = null; }
  if (pararCat) { pararCat(); pararCat = null; }
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
  gestiones = [];
  deals = [];
  fichas = [];
  cuentasSprint = [];
}

// ═══════════════════════════════════════════
// ESTRUCTURA BASE
// ═══════════════════════════════════════════
function pintarEstructura() {
  const u = obtenerUsuario();
  $("page-agenda").innerHTML = `
    <style>
      .ag-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
      .ag-subtab{padding:6px 14px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .ag-subtab:hover{border-color:var(--blue);color:var(--blue)}
      .ag-subtab.active{background:var(--blue);border-color:var(--blue);color:#fff}
      .ag-dia{margin-bottom:4px}
      .ag-dia-hdr{font-size:12px;font-weight:700;color:var(--txt2);text-transform:capitalize;padding:14px 0 8px;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between}
      .ag-item{padding:12px 4px;border-bottom:.5px solid var(--border);display:flex;gap:12px;align-items:flex-start}
      .ag-item:hover{background:var(--s2)}
      .ag-hora{width:52px;flex-shrink:0;font-size:12px;font-weight:600;color:var(--txt2);padding-top:2px}
      .ag-cuerpo{flex:1;min-width:0}
      .ag-cuenta{font-size:14px;font-weight:600}
      .ag-opp{font-size:12px;color:var(--txt2);margin-top:1px}
      .ag-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}
      .ag-ciudad{font-size:11px;color:var(--txt3)}
      .ag-notas{font-size:12px;color:var(--txt2);margin-top:6px;background:var(--s2);border-radius:8px;padding:8px 10px}
      .ag-rep-tag{font-size:11px;font-weight:600;color:var(--txt2)}
      .pl-g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .ag-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      @media(max-width:820px){.pl-g2{grid-template-columns:1fr}.ag-g3{grid-template-columns:1fr}.ag-hora{width:44px}}
      .m-card.clic{cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s}
      .m-card.clic:hover{box-shadow:0 4px 14px rgba(0,0,0,.10);transform:translateY(-2px)}
      .m-card.clic.activa{border:2px solid var(--blue);box-shadow:0 0 0 3px var(--blue-l)}
      .sem-nav{display:flex;align-items:center;gap:6px;background:var(--surface);border:.5px solid var(--border);border-radius:99px;padding:3px 6px}
      .sem-nav button{background:none;border:none;font-size:14px;cursor:pointer;padding:3px 8px;border-radius:99px;font-family:inherit}
      .sem-nav button:hover{background:var(--s2)}
      .sem-nav span{font-size:12px;font-weight:600;min-width:170px;text-align:center}
      .cmp-heads{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
      .cmp-tbl{width:100%;font-size:13px;border-collapse:collapse}
      .cmp-tbl td,.cmp-tbl th{padding:9px 8px;border-bottom:.5px solid var(--border);text-align:center}
      .cmp-tbl td:first-child,.cmp-tbl th:first-child{text-align:left;color:var(--txt2)}
      .cmp-delta{font-size:11px;font-weight:700;border-radius:99px;padding:1px 8px}
      .hint{font-size:11px;color:var(--txt3);margin:-8px 0 12px}
      .rep-hero{background:linear-gradient(135deg,#1e3a8a,#2563EB);border-radius:12px;padding:24px;color:#fff;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
      .rep-hero-name{font-size:22px;font-weight:700;margin-bottom:4px}
      .rep-hero-sub{font-size:13px;opacity:.75}
      .rep-hero button{background:rgba(255,255,255,.18)}
      .rep-hero button:hover{background:rgba(255,255,255,.3)}
      .rep-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
      .rep-metric{background:var(--surface);border-radius:var(--r);border:.5px solid var(--border);padding:14px;cursor:pointer;transition:transform .15s,box-shadow .15s}
      .rep-metric:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.1)}
      .rep-metric-lbl{font-size:11px;color:var(--txt2);margin-bottom:4px}
      .rep-metric-val{font-size:20px;font-weight:700;color:var(--txt)}
      .rep-metric-sub{font-size:11px;color:var(--txt3);margin-top:2px}
      @media(max-width:480px){.rep-metrics{grid-template-columns:1fr 1fr}.rep-hero{padding:18px}.rep-hero-name{font-size:18px}}
      .eq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
      .eq-card{background:var(--surface);border:.5px solid var(--border);border-radius:var(--r);padding:16px;cursor:pointer;transition:box-shadow .15s,transform .15s}
      .eq-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.10);transform:translateY(-2px)}
      .eq-hdr{display:flex;gap:10px;align-items:center;margin-bottom:10px}
      .eq-avatar{width:36px;height:36px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
      .eq-nombre{font-weight:700;font-size:14px}
      .eq-big{font-size:26px;font-weight:700;line-height:1}
      .eq-big-sub{font-size:11px;color:var(--txt3);margin-top:2px}
      .eq-rows{margin-top:10px;font-size:12px;color:var(--txt2);display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .eq-btns{display:flex;gap:6px;margin-top:12px}
      .eq-btn{flex:1;padding:7px 4px;font-size:11px;font-weight:600;border-radius:8px;border:none;background:var(--s2);cursor:pointer;font-family:inherit;color:var(--txt2)}
      .eq-btn:hover{background:var(--blue-l);color:#1d4ed8}
      .link-box{grid-column:1/-1;background:var(--blue-l);border:1.5px solid #bfdbfe;border-radius:10px;padding:12px}
      .link-box .form-label{color:#1d4ed8}
      .link-nota{font-size:11px;color:#1d4ed8;margin-top:6px}
      .sprint-box{background:var(--amber-l);border-color:#fde68a}
      .sprint-box .form-label{color:#92400e}
      .sprint-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#92400e;padding:9px 0;cursor:pointer}
      .sprint-check input{width:16px;height:16px}
      @media(max-width:820px){.cmp-heads{grid-template-columns:1fr}}
      /* v5 · bloque de cuenta y contacto */
      .cta-box{grid-column:1/-1;border:1.5px solid var(--border);border-radius:10px;padding:12px;background:var(--surface)}
      .seg{display:inline-flex;background:var(--s2);border-radius:99px;padding:3px;margin-bottom:10px}
      .seg button{border:none;background:none;padding:6px 14px;border-radius:99px;font-size:12px;font-weight:600;color:var(--txt2);cursor:pointer;font-family:inherit}
      .seg button.on{background:var(--surface);color:var(--txt);box-shadow:0 1px 3px rgba(0,0,0,.12)}
      .cta-res{font-size:12px;margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-height:20px}
      .cta-res .ok{color:#15803d;font-weight:600}
      .cta-res .warn{color:#b45309;font-weight:600}
      .cta-res button{border:none;background:var(--blue-l);color:#1d4ed8;font-weight:600;font-size:11px;border-radius:99px;padding:3px 10px;cursor:pointer;font-family:inherit}
      .cta-auto{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .cta-sub{font-size:11px;color:var(--txt3);margin-top:4px}
      .ct-info{font-size:12px;color:var(--txt2);margin-top:6px;line-height:1.5}
      .ct-info a{color:var(--blue);text-decoration:none}
      .ag-ro{background:var(--s2);color:var(--txt2)}
      .hist-box{grid-column:1/-1;border-left:3px solid var(--purple);background:var(--s2);border-radius:0 10px 10px 0;padding:10px 12px}
      .hist-tit{font-size:12px;font-weight:700;color:var(--txt2);display:flex;justify-content:space-between;align-items:center}
      .hist-it{padding:8px 0;border-bottom:.5px solid var(--border);font-size:12px}
      .hist-it:last-child{border-bottom:none}
      .hist-fecha{font-weight:600;color:var(--txt)}
      .hist-meta{color:var(--txt3)}
      .hist-nota{color:var(--txt2);margin-top:3px;white-space:pre-wrap}
      .hist-mas{border:none;background:none;color:var(--blue);font-weight:600;font-size:12px;cursor:pointer;padding:6px 0 0;font-family:inherit}
      /* v5 · histórico */
      .his-ctrl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
      .his-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px}
      .his-kpi{background:var(--surface);border:.5px solid var(--border);border-radius:var(--r);padding:14px}
      .his-kpi .l{font-size:11px;color:var(--txt2);margin-bottom:4px}
      .his-kpi .v{font-size:22px;font-weight:700;line-height:1.15}
      .his-kpi .s{font-size:11px;color:var(--txt3);margin-top:4px}
      .his-kpi.main{background:linear-gradient(135deg,#1e3a8a,#2563EB);color:#fff;border:none}
      .his-kpi.main .l,.his-kpi.main .s{color:rgba(255,255,255,.8)}
      .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
      .his-tbl{border-collapse:separate;border-spacing:3px;font-size:12px;min-width:100%}
      .his-tbl th{font-weight:600;color:var(--txt2);padding:6px 6px;text-align:center;white-space:nowrap;font-size:11px}
      .his-tbl th.sel{color:var(--blue)}
      .his-tbl th.mes{cursor:pointer}
      .his-tbl th.mes:hover{color:var(--blue)}
      .his-tbl td{text-align:center;padding:7px 6px;border-radius:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
      .his-tbl td.lbl{text-align:left;color:var(--txt2);background:none;font-weight:500;cursor:pointer;position:sticky;left:0;background:var(--surface)}
      .his-tbl tr.on td.lbl{color:var(--blue);font-weight:700}
      .his-tbl td.tot{font-weight:700;background:var(--s2)}
      .his-tbl td small{display:block;font-size:10px;font-weight:600;margin-top:1px}
      .his-tbl td.sel{outline:2px solid var(--blue);outline-offset:-2px}
      .up{color:#15803d}.down{color:#b91c1c}.eq{color:var(--txt3)}
    </style>

    <div class="page-hdr">
      <div>
        <div class="page-title">Agenda Comercial</div>
        <div class="page-sub">${esAdmin() ? "Gestiones y visitas del equipo" : "Mis gestiones — " + esc(u.nombreRep)}</div>
      </div>
      <button class="btn-primario" id="ag-btn-nueva">＋ Registrar gestión</button>
    </div>

    <div class="ag-subtabs">
      ${esAdmin() ? "" : `<button class="ag-subtab active" id="ag-st-mia">👤 Mi Agenda</button>`}
      <button class="ag-subtab ${esAdmin() ? "active" : ""}" id="ag-st-sem">🗓 Semana actual</button>
      ${esAdmin() ? `<button class="ag-subtab" id="ag-st-eq">👥 Equipo</button>` : ""}
      <button class="ag-subtab" id="ag-st-mes">📊 Reporte mensual</button>
      <button class="ag-subtab" id="ag-st-cmp">📈 Histórico</button>
    </div>

    <!-- ═══ MI AGENDA (solo reps: únicamente SUS gestiones) ═══ -->
    <div id="ag-sub-mia" style="display:${esAdmin() ? "none" : "block"}"></div>

    <!-- ═══ SEMANA ═══ -->
    <div id="ag-sub-sem" style="display:${esAdmin() ? "block" : "none"}">
      <div class="filtros-bar">
        <div class="sem-nav">
          <button id="sem-prev" title="Semana anterior">◀</button>
          <span id="sem-rango"></span>
          <button id="sem-next" title="Semana siguiente">▶</button>
        </div>
        <button class="btn-secundario" id="sem-hoy" style="padding:7px 12px;font-size:12px">Hoy</button>
        <select class="filtro-select" id="sem-f-rep" style="${esAdmin() ? "" : "display:none"}"><option value="">Rep: Todos</option></select>
        <span class="filtro-conteo" id="sem-conteo"></span>
      </div>
      <div class="m-grid" id="sem-metricas"></div>
      <p class="hint">💡 Haz clic en las tarjetas para filtrar; clic en las barras de un día para verlo.</p>
      <div class="card">
        <p class="section-lbl">Gestiones por día de la semana</p>
        <div style="height:170px;position:relative"><canvas id="sem-ch"></canvas></div>
      </div>
      <div class="card" id="sem-lista"></div>
    </div>

    <!-- ═══ EQUIPO (solo Gerencia): tarjeta por rep ═══ -->
    <div id="ag-sub-eq" style="display:none">
      <div class="filtros-bar">
        <select class="filtro-select" id="eq-mes"></select>
        <span class="filtro-conteo" id="eq-conteo"></span>
      </div>
      <p class="hint">💡 Haz clic en un rep para su reporte mensual, o usa los botones para ver su semana o su mes.</p>
      <div class="eq-grid" id="eq-cards"></div>
    </div>

    <!-- ═══ MENSUAL ═══ -->
    <div id="ag-sub-mes" style="display:none">
      <div class="m-grid" id="ag-metricas"></div>
      <p class="hint">💡 Haz clic en las tarjetas, en las barras, en la dona o en la composición para filtrar la lista.</p>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Gestiones por rep</p>
          <div style="height:190px;position:relative"><canvas id="ag-ch-reps"></canvas></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Gestiones comerciales por etapa</p>
          <div style="height:190px;position:relative"><canvas id="ag-ch-etapas"></canvas></div>
        </div>
      </div>
      <div class="card">
        <p class="section-lbl">Composición de las gestiones (100%) — clic en un segmento para filtrar</p>
        <div style="height:250px;position:relative"><canvas id="ag-ch-comp"></canvas></div>
      </div>
      <div class="filtros-bar">
        <input class="filtro-input" id="ag-f-texto" placeholder="🔍 Buscar cuenta, oportunidad, contacto o nota..."/>
        <select class="filtro-select" id="ag-f-mes"><option value="">Mes: Todos</option></select>
        <select class="filtro-select" id="ag-f-rep" style="${esAdmin() ? "" : "display:none"}"><option value="">Rep: Todos</option></select>
        <select class="filtro-select" id="ag-f-tipo">
          <option value="">Tipo: Todos</option>
          <option>Comercial</option>
          <option>Operativo</option>
        </select>
        <select class="filtro-select" id="ag-f-segmento">
          <option value="">Segmento: Todos</option>
          ${SEGMENTOS.map(x => `<option>${x}</option>`).join("")}
        </select>
        <select class="filtro-select" id="ag-f-negocio">
          <option value="">Modalidad: Todas</option>
          <option>Venta</option>
          <option>Renta</option>
        </select>
        <select class="filtro-select" id="ag-f-modalidad">
          <option value="">Reunión: Todas</option>
          <option>Virtual</option>
          <option>Presencial</option>
        </select>
        <select class="filtro-select" id="ag-f-etapa"><option value="">Etapa: Todas</option>
          ${ETAPAS.map(e => `<option>${e}</option>`).join("")}
        </select>
        <button class="btn-secundario" id="ag-f-limpiar" style="padding:7px 12px;font-size:12px">✕ Limpiar</button>
        <button class="btn-secundario" id="ag-btn-csv" style="padding:7px 12px;font-size:12px">⬇ CSV</button>
        <span class="filtro-conteo" id="ag-conteo"></span>
      </div>
      <div class="card" id="ag-lista"></div>
    </div>

    <!-- ═══ HISTÓRICO (comparativo de meses) ═══ -->
    <div id="ag-sub-cmp" style="display:none">
      <div class="his-ctrl">
        <select class="filtro-select" id="his-fy"></select>
        <select class="filtro-select" id="his-ind">
          ${Object.entries(INDICADORES).map(([k, i]) => `<option value="${k}">${i.t}</option>`).join("")}
        </select>
        <select class="filtro-select" id="his-mes"></select>
        <select class="filtro-select" id="his-rep" style="${esAdmin() ? "" : "display:none"}"><option value="">Rep: Todo el equipo</option></select>
      </div>
      <div class="his-kpis" id="his-kpis"></div>
      <div class="card">
        <p class="section-lbl" id="his-ch-tit">Mes a mes</p>
        <p class="hint" style="margin:0 0 8px">💡 Clic en una barra para seleccionar el mes. La línea punteada es el promedio de los meses cerrados.</p>
        <div style="height:250px;position:relative"><canvas id="evo-ch"></canvas></div>
      </div>
      <div class="card">
        <p class="section-lbl">Comparativo histórico — todos los indicadores, mes a mes</p>
        <p class="hint" style="margin:0 0 8px">💡 Color más intenso = mes más alto del indicador. Debajo de cada valor, la variación vs el mes anterior. Clic en un mes o en un indicador para analizarlo arriba.</p>
        <div class="tbl-wrap"><table class="his-tbl" id="his-tabla"></table></div>
      </div>
      <div class="card" id="his-rep-card">
        <p class="section-lbl" id="his-rep-tit">Por rep, mes a mes</p>
        <div class="tbl-wrap"><table class="his-tbl" id="his-rep-tabla"></table></div>
      </div>
      <div class="card">
        <p class="section-lbl">Comparar dos meses en detalle</p>
        <div class="filtros-bar" style="margin-top:10px">
          <select class="filtro-select" id="cmp-a"></select>
          <span style="font-size:13px;color:var(--txt3)">vs</span>
          <select class="filtro-select" id="cmp-b"></select>
        </div>
        <table class="cmp-tbl" id="cmp-tabla"></table>
        <div style="height:230px;position:relative;margin-top:14px"><canvas id="cmp-ch"></canvas></div>
      </div>
    </div>

    <!-- MODAL REGISTRAR/EDITAR GESTIÓN -->
    <div class="modal-overlay" id="ag-modal">
      <div class="modal-box">
        <div class="modal-hdr">
          <span class="modal-title" id="ag-modal-titulo">Registrar gestión</span>
          <button class="modal-close" id="ag-modal-cerrar">×</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">Rep *</label>
              <select class="form-select" id="ag-c-rep"></select></div>
            <div class="form-group"><label class="form-label">Ciudad</label>
              <input class="form-input ag-ro" id="ag-c-ciudad" value="${CIUDAD_FIJA}" readonly tabindex="-1"/></div>
            <div class="form-group"><label class="form-label">Fecha *</label>
              <input class="form-input" id="ag-c-fecha" type="date"/></div>
            <div class="form-group"><label class="form-label">Hora</label>
              <input class="form-input" id="ag-c-hora" type="time"/></div>

            <!-- 🏢 CUENTA: existente o nueva · contacto -->
            <div class="cta-box">
              <label class="form-label">Cuenta / Cliente *</label>
              <div class="seg" role="tablist">
                <button type="button" id="ag-cta-modo-ex" class="on">🔁 Cuenta existente</button>
                <button type="button" id="ag-cta-modo-nu">✨ Registrar nueva</button>
              </div>
              <input class="form-input" id="ag-c-cuenta" list="ag-dl-cuenta" placeholder="Escribe para buscar la cuenta…" autocomplete="off" style="width:100%"/>
              <datalist id="ag-dl-cuenta"></datalist>
              <div class="cta-res" id="ag-cta-res"></div>
              <div class="form-grid" id="ag-cta-campos" style="margin-top:10px;display:none">
                <div class="form-group" id="ag-seg-wrap"><label class="form-label">Segmento *</label>
                  <select class="form-select" id="ag-c-segmento">
                    <option value="">— Selecciona —</option>
                    ${SEGMENTOS.map(x => `<option value="${x}">${SEGMENTO_TXT[x]}</option>`).join("")}
                  </select></div>
              </div>
              <div class="cta-sub" id="ag-cta-sub"></div>

              <div id="ag-ct-wrap" style="margin-top:12px;display:none">
                <label class="form-label">👤 Contacto</label>
                <select class="form-select" id="ag-c-contacto" style="width:100%"></select>
                <div class="ct-info" id="ag-ct-info"></div>
                <div class="form-grid" id="ag-ct-nuevo" style="margin-top:10px;display:none">
                  <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="ag-c-ct-nombre" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Cargo</label><input class="form-input" id="ag-c-ct-cargo" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="ag-c-ct-correo" type="email" maxlength="160"/></div>
                  <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="ag-c-ct-tel" type="tel" maxlength="40"/></div>
                </div>
              </div>
            </div>

            <!-- 💼 OPORTUNIDAD: seguimiento, nueva o sin oportunidad -->
            <div class="cta-box" id="ag-opp-box">
              <label class="form-label">Oportunidad *</label>
              <div class="seg">
                <button type="button" id="ag-opp-b-seg" class="on">🔄 Seguimiento</button>
                <button type="button" id="ag-opp-b-nue">✨ Nueva oportunidad</button>
                <button type="button" id="ag-opp-b-sin">⚪ Sin oportunidad</button>
              </div>
              <div id="ag-opp-w-seg">
                <select class="form-select" id="ag-c-deal" style="width:100%"></select>
                <div class="cta-sub" id="ag-opp-seg-nota"></div>
                <div class="cta-sub" id="ag-opp-op" style="display:none">Gestión operativa: queda asociada a la oportunidad sin cambiar su estado ni su valor.</div>
              </div>
              <div id="ag-opp-w-nue" style="display:none">
                <input class="form-input" id="ag-c-oportunidad" placeholder="Nombre de la oportunidad (ej. Remodelación piso 5)" maxlength="120" style="width:100%"/>
                <div class="cta-sub">Se crea en el Pipeline a nombre de la cuenta elegida.</div>
              </div>
              <div id="ag-opp-w-sin" style="display:none" class="cta-sub">Para visitas de relacionamiento o gestiones operativas que no corresponden a una oportunidad del pipeline.<span id="ag-opp-legado"></span></div>
              <div id="ag-link-campos" style="display:none;margin-top:10px">
                <div class="form-grid">
                  <div class="form-group"><label class="form-label">Estado de la oportunidad</label>
                    <select class="form-select" id="ag-c-deal-estado">
                      ${ESTADOS_PIPE.map(e => `<option>${e}</option>`).join("")}
                    </select></div>
                  <div class="form-group"><label class="form-label">Valor (COP)</label>
                    <input class="form-input" id="ag-c-deal-valor" type="number" min="0" placeholder="0"/></div>
                </div>
                <div class="form-grid" id="ag-link-nueva" style="display:none;margin-top:10px">
                  <div class="form-group"><label class="form-label">Canal *</label>
                    <select class="form-select" id="ag-c-deal-canal"><option value="">— Selecciona —</option>${CANALES.map(c => `<option>${c}</option>`).join("")}</select></div>
                  <div class="form-group"><label class="form-label">Origen *</label>
                    <select class="form-select" id="ag-c-deal-origen"></select></div>
                  <div class="form-group full" id="ag-deal-brk-wrap" style="display:none"><label class="form-label">Broker *</label>
                    <select class="form-select" id="ag-c-deal-broker"></select>
                    <div class="link-nota">¿No está? Créalo en Pipeline → 🤝 Brokers o en el formulario de oportunidad.</div></div>
                </div>
                <div class="link-nota" id="ag-link-nota"></div>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Modalidad *</label>
              <select class="form-select" id="ag-c-negocio">
                <option value="">— Selecciona —</option>
                <option value="Venta">🛒 Venta</option>
                <option value="Renta">🔑 Renta</option>
              </select></div>
            <div class="form-group"><label class="form-label">Tipo de reunión *</label>
              <select class="form-select" id="ag-c-modalidad">
                <option value="">— Selecciona —</option>
                <option value="Presencial">🤝 Presencial</option>
                <option value="Virtual">💻 Virtual</option>
              </select></div>
            <div class="form-group full"><label class="form-label">Tipo de gestión *</label>
              <select class="form-select" id="ag-c-tipo">
                <option value="">— Selecciona —</option>
                <option value="Comercial">💼 Comercial</option>
                <option value="Operativo">⚙️ Operativo</option>
              </select></div>
            <div class="form-group full" id="ag-etapa-wrap" style="display:none">
              <label class="form-label">Etapa comercial *</label>
              <select class="form-select" id="ag-c-etapa">
                <option value="">— Selecciona la etapa —</option>
                <option value="Identificado">🔍 Identificado</option>
                <option value="Seguimiento">🔄 Seguimiento</option>
                <option value="Cotización">📄 Cotización</option>
                <option value="Diseño">✏️ Diseño</option>
                <option value="Negociación">🤝 Negociación</option>
              </select></div>

            <!-- 🚀 SPRINT DE TRACCIÓN (opcional) -->
            <div class="link-box sprint-box">
              <label class="form-label">🚀 Sprint de Tracción (opcional)</label>
              <select class="form-select" id="ag-c-sprint" style="width:100%">
                <option value="">— No es una acción del sprint —</option>
                ${Object.entries(ACCIONES_SPRINT).map(([k, a]) => `<option value="${k}">${a.label}</option>`).join("")}
              </select>
              <div id="ag-sprint-ruta" style="display:none;margin-top:10px">
                <div class="form-grid">
                  <div class="form-group"><label class="form-label">Paso de la ruta</label>
                    <select class="form-select" id="ag-c-sprint-paso">
                      ${PASOS_RUTA.map(p => `<option>${p}</option>`).join("")}
                    </select></div>
                  <div class="form-group" style="justify-content:flex-end">
                    <label class="sprint-check"><input type="checkbox" id="ag-c-sprint-decisor"/> Hubo conversación con el decisor</label></div>
                </div>
              </div>
            </div>

            <div class="form-group full"><label class="form-label">Descripción / Notas</label>
              <textarea class="form-input" id="ag-c-notas" rows="3" maxlength="1000" placeholder="¿Qué pasó en la visita? ¿Cuál es el siguiente paso?"></textarea></div>
            <div class="hist-box" id="ag-hist" style="display:none"></div>
          </div>
          <div class="login-error" id="ag-modal-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-peligro" id="ag-btn-eliminar" style="display:none">🗑 Eliminar</button>
          <button class="btn-secundario" id="ag-btn-cancelar">Cancelar</button>
          <button class="btn-primario" id="ag-btn-guardar">💾 Guardar gestión</button>
        </div>
      </div>
    </div>
  `;

  const selRep = $("ag-c-rep");
  if (esAdmin()) {
    selRep.innerHTML = `<option value="">Seleccionar...</option>` +
      REPS_BASE.map(r => `<option>${r}</option>`).join("");
  } else {
    selRep.innerHTML = `<option>${esc(u.nombreRep)}</option>`;
    selRep.disabled = true;
  }

  // Sub-pestañas
  if (!esAdmin()) $("ag-st-mia").addEventListener("click", () => mostrarSub("mia"));
  if (esAdmin()) {
    $("ag-st-eq").addEventListener("click", () => mostrarSub("eq"));
    $("eq-mes").addEventListener("change", (e) => { eqMes = e.target.value; renderEquipo(); });
  }
  $("ag-st-sem").addEventListener("click", () => mostrarSub("sem"));
  $("ag-st-mes").addEventListener("click", () => mostrarSub("mes"));
  $("ag-st-cmp").addEventListener("click", () => mostrarSub("cmp"));

  // Semana
  $("sem-prev").addEventListener("click", () => { semanaOffset--; renderSemana(); });
  $("sem-next").addEventListener("click", () => { semanaOffset++; renderSemana(); });
  $("sem-hoy").addEventListener("click", () => { semanaOffset = 0; renderSemana(); });
  $("sem-f-rep").addEventListener("change", (e) => { semRep = e.target.value; renderSemana(); });

  // Modal
  $("ag-btn-nueva").addEventListener("click", () => abrirModal(null));
  $("ag-modal-cerrar").addEventListener("click", cerrarModal);
  $("ag-btn-cancelar").addEventListener("click", cerrarModal);
  $("ag-btn-guardar").addEventListener("click", guardar);
  $("ag-btn-eliminar").addEventListener("click", eliminar);
  $("ag-c-tipo").addEventListener("change", () => {
    const esComercial = $("ag-c-tipo").value === "Comercial";
    $("ag-etapa-wrap").style.display = esComercial ? "flex" : "none";
    if (!esComercial) $("ag-c-etapa").value = "";
    alCambiarDeal();
  });
  $("ag-c-etapa").addEventListener("change", sugerirEstadoDesdeEtapa);
  $("ag-c-sprint").addEventListener("change", alCambiarSprint);
  $("ag-c-deal").addEventListener("change", alCambiarDeal);
  $("ag-opp-b-seg").addEventListener("click", () => ponerModoOpp("seg"));
  $("ag-opp-b-nue").addEventListener("click", () => ponerModoOpp("nueva"));
  $("ag-opp-b-sin").addEventListener("click", () => ponerModoOpp("sin"));
  $("ag-c-deal-canal").addEventListener("change", alCambiarCanalDeal);
  // Cuenta existente / nueva + contacto
  $("ag-cta-modo-ex").addEventListener("click", () => ponerModoCuenta("existente"));
  $("ag-cta-modo-nu").addEventListener("click", () => ponerModoCuenta("nueva"));
  $("ag-c-cuenta").addEventListener("input", () => { histLimite = 8; alCambiarCuenta(); });
  $("ag-c-contacto").addEventListener("change", alCambiarContacto);

  // Filtros del mensual
  $("ag-f-texto").addEventListener("input", (e) => { filtros.texto = e.target.value.toLowerCase(); renderMensual(); });
  [["ag-f-mes","mes"],["ag-f-rep","rep"],["ag-f-tipo","tipo"],["ag-f-etapa","etapa"],["ag-f-segmento","segmento"],["ag-f-modalidad","modalidad"],["ag-f-negocio","negocio"]].forEach(([id, clave]) => {
    $(id).addEventListener("change", (e) => { filtros[clave] = e.target.value; renderMensual(); });
  });
  $("ag-f-limpiar").addEventListener("click", () => {
    Object.keys(filtros).forEach(k => filtros[k] = "");
    $("ag-f-texto").value = "";
    ["ag-f-mes","ag-f-rep","ag-f-tipo","ag-f-etapa","ag-f-segmento","ag-f-modalidad","ag-f-negocio"].forEach(id => $(id).value = "");
    renderMensual();
  });
  $("ag-btn-csv").addEventListener("click", exportarCSVAgenda);

  // Histórico
  $("his-fy").addEventListener("change", (e) => { hisFY = parseInt(e.target.value, 10); hisMes = ""; renderHistorico(); });
  $("his-ind").addEventListener("change", (e) => { hisInd = e.target.value; renderHistorico(); });
  $("his-mes").addEventListener("change", (e) => { hisMes = e.target.value; renderHistorico(); });
  $("his-rep").addEventListener("change", (e) => { hisRep = e.target.value; renderHistorico(); });

  // Comparar
  $("cmp-a").addEventListener("change", (e) => { cmpA = e.target.value; renderComparar(); });
  $("cmp-b").addEventListener("change", (e) => { cmpB = e.target.value; renderComparar(); });
}

function mostrarSub(nombre) {
  const mia = $("ag-st-mia");
  if (mia) {
    mia.classList.toggle("active", nombre === "mia");
    $("ag-sub-mia").style.display = nombre === "mia" ? "block" : "none";
  }
  const eq = $("ag-st-eq");
  if (eq) {
    eq.classList.toggle("active", nombre === "eq");
    $("ag-sub-eq").style.display = nombre === "eq" ? "block" : "none";
  }
  $("ag-st-sem").classList.toggle("active", nombre === "sem");
  $("ag-st-mes").classList.toggle("active", nombre === "mes");
  $("ag-st-cmp").classList.toggle("active", nombre === "cmp");
  $("ag-sub-sem").style.display = nombre === "sem" ? "block" : "none";
  $("ag-sub-mes").style.display = nombre === "mes" ? "block" : "none";
  $("ag-sub-cmp").style.display = nombre === "cmp" ? "block" : "none";
}

function mesesEnDatos() {
  return [...new Set(baseGestiones().map(mesDe).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
}

function actualizarOpcionesFiltros() {
  const meses = mesesEnDatos();

  const selMes = $("ag-f-mes");
  if (!mesInicializado) {
    const hoy = new Date();
    const claveHoy = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}`;
    if (meses.includes(claveHoy)) filtros.mes = claveHoy;
    mesInicializado = true;
  }
  selMes.innerHTML = `<option value="">Mes: Todos</option>` +
    meses.map(m => `<option value="${m}" ${m === filtros.mes ? "selected" : ""}>${nombreMes(m)}</option>`).join("");

  const reps = repsVisibles();
  const llenarRep = (id, valorActual) => {
    const sel = $(id);
    sel.innerHTML = `<option value="">Rep: Todos</option>` +
      reps.map(r => `<option ${r === valorActual ? "selected" : ""}>${esc(r)}</option>`).join("");
  };
  llenarRep("ag-f-rep", filtros.rep);
  llenarRep("sem-f-rep", semRep);

  const selEq = $("eq-mes");
  if (selEq) {
    if (!eqMes) {
      const hoyEq = new Date();
      const claveHoyEq = `${hoyEq.getFullYear()}-${pad(hoyEq.getMonth() + 1)}`;
      eqMes = meses.includes(claveHoyEq) ? claveHoyEq : (meses[0] || "");
    }
    selEq.innerHTML = meses.map(m => `<option value="${m}" ${m === eqMes ? "selected" : ""}>${nombreMes(m)}</option>`).join("");
  }

  if (!cmpA && meses[0]) cmpA = meses[0];
  if (!cmpB && meses[1]) cmpB = meses[1];
  const llenarCmp = (id, valor) => {
    $(id).innerHTML = meses.map(m => `<option value="${m}" ${m === valor ? "selected" : ""}>${nombreMes(m)}</option>`).join("");
  };
  llenarCmp("cmp-a", cmpA);
  llenarCmp("cmp-b", cmpB);

  const selHisRep = $("his-rep");
  if (selHisRep) selHisRep.innerHTML = `<option value="">Rep: Todo el equipo</option>` +
    reps.map(r => `<option ${r === hisRep ? "selected" : ""}>${esc(r)}</option>`).join("");
}

// ═══════════════════════════════════════════
// 🔗 TRAZABILIDAD: selector de oportunidades
// ═══════════════════════════════════════════
// Oportunidades de la CUENTA elegida en el formulario.
// Gerencia ve y vincula todas; un vendedor solo las suyas (las reglas solo
// le dejan actualizar sus oportunidades). Activas primero.
function dealsDeCuenta() {
  const info = modoCuenta === "existente" ? infoCuenta($("ag-c-cuenta").value.trim()) : null;
  if (!info) return { info: null, propias: [], ajenas: [] };
  const u = obtenerUsuario();
  const todas = deals.filter(d => String(d.cuenta || "").trim() && claveCuenta(d.cuenta) === info.clave);
  const propias = esAdmin() ? todas : todas.filter(d => d.rep === u?.nombreRep);
  const orden = { "Negociación": 1, "En diseño": 2, "Cotizado": 3, "Identificado": 4, "On hold": 5, "Ganado": 6, "Perdido": 7 };
  propias.sort((a, b) => (orden[a.estado] || 9) - (orden[b.estado] || 9) || String(a.oportunidad || "").localeCompare(String(b.oportunidad || ""), "es"));
  return { info, propias, ajenas: todas.filter(d => !propias.includes(d)) };
}

function poblarSelectDeals() {
  const sel = $("ag-c-deal");
  if (!sel) return;
  const actual = sel.value;
  const { info, propias, ajenas } = dealsDeCuenta();
  const nota = $("ag-opp-seg-nota");
  if (!info) {
    sel.innerHTML = `<option value="">— Elige primero una cuenta existente —</option>`;
    nota.textContent = modoCuenta === "nueva" ? "Una cuenta nueva aún no tiene oportunidades: usa ✨ Nueva oportunidad." : "";
  } else if (!propias.length) {
    sel.innerHTML = `<option value="">— ${esc(info.nombre)} no tiene oportunidades${esAdmin() ? "" : " tuyas"} en el pipeline —</option>`;
    nota.innerHTML = `Usa <b>✨ Nueva oportunidad</b> para crearla.` + (ajenas.length ? ` (Hay ${ajenas.length} de otros reps: ${[...new Set(ajenas.map(d => (d.rep || "").split(" ")[0]))].map(esc).join(", ")}.)` : "");
  } else {
    sel.innerHTML = `<option value="">— Elige la oportunidad (${propias.length}) —</option>` +
      propias.map(d => `<option value="${esc(d.id)}">${esc(d.oportunidad || "(sin nombre)")} — ${esc(d.estado || "")} · ${fmt(d.valor)}${esAdmin() ? " · " + esc((d.rep || "").split(" ")[0]) : ""}</option>`).join("");
    nota.textContent = ajenas.length ? `También hay ${ajenas.length} oportunidad(es) de otros reps en esta cuenta.` : "";
  }
  if ([...sel.options].some(o => o.value === actual)) sel.value = actual;
}

function ponerModoOpp(modo) {
  modoOpp = modo;
  $("ag-opp-b-seg").classList.toggle("on", modo === "seg");
  $("ag-opp-b-nue").classList.toggle("on", modo === "nueva");
  $("ag-opp-b-sin").classList.toggle("on", modo === "sin");
  $("ag-opp-w-seg").style.display = modo === "seg" ? "block" : "none";
  $("ag-opp-w-nue").style.display = modo === "nueva" ? "block" : "none";
  $("ag-opp-w-sin").style.display = modo === "sin" ? "block" : "none";
  $("ag-opp-legado").innerHTML = modo === "sin" && oppLegado ? `<br>Texto actual: <b>${esc(oppLegado)}</b>` : "";
  if (modo === "seg") poblarSelectDeals();
  alCambiarDeal();
  if (modo === "nueva") $("ag-c-oportunidad").focus();
}

// Vínculo con el pipeline según el modo: id de la oportunidad, "__nueva__" o ""
function vinculoActual() {
  if (modoOpp === "nueva") return "__nueva__";
  if (modoOpp === "seg") return $("ag-c-deal").value;
  return "";
}

function alCambiarDeal() {
  const val = vinculoActual();
  const campos = $("ag-link-campos");
  const nota = $("ag-link-nota");
  const esComercial = $("ag-c-tipo").value === "Comercial";
  // Estado/valor: al crear siempre; en seguimiento solo si la gestión es comercial
  if (!val || (val !== "__nueva__" && !esComercial)) {
    campos.style.display = "none";
    if (val && $("ag-c-tipo").value === "Operativo") $("ag-link-nota").textContent = "";
    const aviso = $("ag-opp-op");
    if (aviso) aviso.style.display = val && $("ag-c-tipo").value === "Operativo" ? "block" : "none";
    return;
  }
  campos.style.display = "block";

  $("ag-link-nueva").style.display = val === "__nueva__" ? "grid" : "none";
  if (val === "__nueva__") {
    if (!$("ag-c-deal-canal").value) { $("ag-c-deal-valor").value = ""; alCambiarCanalDeal(); }
    sugerirEstadoDesdeEtapa();
    if (!MAPA_ETAPA_ESTADO[$("ag-c-etapa").value]) $("ag-c-deal-estado").value = "Identificado";
    nota.textContent = "Se creará en el pipeline con la cuenta elegida.";
  } else {
    const d = deals.find(x => x.id === val);
    if (d) {
      $("ag-c-deal-valor").value = d.valor ?? "";
      // Una oportunidad ya Ganada o Perdida no cambia de estado por la etapa de la gestión
      const cerrada = d.estado === "Ganado" || d.estado === "Perdido";
      const sugerido = cerrada ? d.estado : (MAPA_ETAPA_ESTADO[$("ag-c-etapa").value] || d.estado || "Identificado");
      $("ag-c-deal-estado").value = sugerido;
      nota.textContent = cerrada
        ? `“${d.oportunidad}” ya está ${d.estado}: se mantiene así salvo que cambies el estado aquí.`
        : `Se actualizarán el estado y el valor de “${d.oportunidad}” en el pipeline.`;
    }
  }
}

// Oportunidad nueva desde la agenda: canal → origen (Directo) o broker (Indirecto)
function alCambiarCanalDeal() {
  const canal = $("ag-c-deal-canal").value;
  const sel = $("ag-c-deal-origen");
  if (canal === "Indirecto") { sel.innerHTML = `<option value="${ORIGEN_INDIRECTO}">🤝 ${ORIGEN_INDIRECTO}</option>`; sel.disabled = true; }
  else if (canal === "Directo") { sel.disabled = false; sel.innerHTML = `<option value="">— Selecciona —</option>` + ORIGENES_DIRECTO.map(o => `<option>${o}</option>`).join(""); }
  else { sel.disabled = true; sel.innerHTML = `<option value="">Elige primero el canal</option>`; }
  $("ag-deal-brk-wrap").style.display = canal === "Indirecto" ? "flex" : "none";
  const bs = $("ag-c-deal-broker");
  const lista = listaBrokers();
  bs.innerHTML = `<option value="">${lista.length ? "— Selecciona el broker —" : "— Aún no hay brokers creados —"}</option>` +
    lista.map(b => `<option value="${esc(b.nombre)}">${esc(b.nombre)}</option>`).join("");
}

function sugerirEstadoDesdeEtapa() {
  const val = vinculoActual();
  if (!val) return;
  const d = val !== "__nueva__" ? deals.find(x => x.id === val) : null;
  if (d && (d.estado === "Ganado" || d.estado === "Perdido")) return;
  const sugerido = MAPA_ETAPA_ESTADO[$("ag-c-etapa").value];
  if (sugerido) $("ag-c-deal-estado").value = sugerido;
}

// ═══════════════════════════════════════════
// 🏢 CUENTAS: índice único de clientes (v5)
// Une 4 fuentes para saber si una cuenta YA EXISTE y qué se sabe de ella:
//   1. Ficha (colección `cuentas`)  → canal, sector, contactos
//   2. Gestiones de la agenda       → canal/sector/contacto más recientes
//   3. Oportunidades del pipeline   → segmento Retail/Corporativo
//   4. Base instalada del sprint    → contacto
// La llave es idCuenta(nombre): sin tildes, mayúsculas ni signos.
// ═══════════════════════════════════════════
let indice = new Map();


function construirIndice() {
  const m = new Map();
  const tomar = (nombre) => {
    const n = String(nombre || "").trim();
    if (!n) return null;
    const k = idCuenta(n);
    if (!m.has(k)) m.set(k, { clave: k, nombre: n, variantes: {}, fichaId: null, ficha: null, segmento: "", contactos: [], nGestiones: 0, ultima: "", enPipeline: false, enSprint: false });
    const c = m.get(k);
    c.variantes[n] = (c.variantes[n] || 0) + 1;
    return c;
  };
  const sumarContacto = (c, ct) => {
    const nom = String(ct?.nombre || "").trim();
    if (!c || !nom) return;
    const ya = c.contactos.find(x => normNombre(x.nombre) === normNombre(nom));
    if (ya) {   // completa datos que falten
      ["cargo", "correo", "telefono"].forEach(k => { if (!ya[k] && ct[k]) ya[k] = ct[k]; });
      return;
    }
    c.contactos.push({ nombre: nom, cargo: ct.cargo || "", correo: ct.correo || "", telefono: ct.telefono || "", fecha: ct.fecha || "" });
  };

  // 1. Fichas (mandan sobre el nombre oficial y el segmento)
  fichas.forEach(f => {
    const c = tomar(f.nombre || f.id);
    if (!c) return;
    if (!c.fichaId || f.id === c.clave) { c.fichaId = f.id; c.ficha = f; }
    if (!c.segmento) c.segmento = segmentoDeRegistro(f);
    [...(f.contactos || [])].sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || String(b.fecha || "").localeCompare(String(a.fecha || ""))).forEach(ct => sumarContacto(c, ct));
  });
  // 2. Gestiones (de la más reciente a la más antigua)
  [...gestiones].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""))).forEach(g => {
    const c = tomar(g.cuenta);
    if (!c) return;
    c.nGestiones++;
    if (!c.ultima) c.ultima = g.fecha || "";
    if (!c.segmento) c.segmento = segDe(g);
    if (g.contactoNombre) sumarContacto(c, { nombre: g.contactoNombre, cargo: g.contactoCargo, correo: g.contactoCorreo, telefono: g.contactoTelefono, fecha: g.fecha });
  });
  // 3. Pipeline
  deals.forEach(d => {
    const c = tomar(d.cuenta);
    if (!c) return;
    c.enPipeline = true;
    if (!c.segmento) c.segmento = normSegmento(d.segmento) || normSegmento(d.canal);
  });
  // 4. Base instalada del sprint
  cuentasSprint.forEach(cs => {
    const c = tomar(cs.cuenta);
    if (!c) return;
    c.enSprint = true;
    if (cs.contactoNombre) sumarContacto(c, { nombre: cs.contactoNombre, cargo: cs.contactoCargo, correo: cs.contactoCorreo, telefono: cs.contactoTelefono });
  });
  // Nombre oficial: el de la ficha; si no, la escritura más usada.
  // Los contactos que Gerencia borró (contactosOcultos) no se muestran.
  m.forEach(c => {
    c.nombre = c.ficha?.nombre || nombrePreferido(c.variantes);
    const ocultos = new Set((c.ficha?.contactosOcultos || []).map(normNombre));
    if (ocultos.size) c.contactos = c.contactos.filter(x => !ocultos.has(normNombre(x.nombre)));
  });
  indice = m;
}

function infoCuenta(nombre) { return nombre ? indice.get(idCuenta(nombre)) || null : null; }

function refrescarCuentas() {
  construirIndice();
  const el = $("ag-dl-cuenta");
  if (el) el.innerHTML = [...indice.values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map(c => `<option value="${esc(c.nombre)}">`).join("");
  // Si el modal está abierto, refresca el estado de la cuenta sin perder lo escrito
  if ($("ag-modal")?.classList.contains("open")) alCambiarCuenta(true);
}

function ponerModoCuenta(modo) {
  modoCuenta = modo;
  $("ag-cta-modo-ex").classList.toggle("on", modo === "existente");
  $("ag-cta-modo-nu").classList.toggle("on", modo === "nueva");
  $("ag-c-cuenta").placeholder = modo === "existente" ? "Escribe para buscar la cuenta…" : "Nombre de la cuenta nueva";
  $("ag-c-cuenta").setAttribute("list", modo === "existente" ? "ag-dl-cuenta" : "");
  if (modo === "nueva") $("ag-c-segmento").value = "";
  alCambiarCuenta();
  $("ag-c-cuenta").focus();
}

// conservar = true: no reinicia el contacto elegido (refresco en vivo)
function alCambiarCuenta(conservar) {
  const nombre = $("ag-c-cuenta").value.trim();
  const info = infoCuenta(nombre);
  const res = $("ag-cta-res"), campos = $("ag-cta-campos"), sub = $("ag-cta-sub");
  let mostrarSeg = false, mostrarContactos = false;
  sub.textContent = "";

  const chips = (c, tipoCli) => [
    chip(tipoCli === "Nuevo" ? "✨ Cliente nuevo" : "🔁 Cliente existente", tipoCli === "Nuevo" ? "#CCFBF1" : "#EFF6FF", tipoCli === "Nuevo" ? "#0f766e" : "#1d4ed8"),
    c?.segmento ? chip(SEGMENTO_TXT[c.segmento], "#F3F4F6", "#374151") : "",
    c?.nGestiones ? `<span class="hist-meta">${c.nGestiones} gestión(es)${c.ultima ? " · última " + esc(c.ultima) : ""}</span>` : "",
    c?.enPipeline ? chip("🔗 En pipeline", "#EFF6FF", "#1d4ed8") : "",
    c?.enSprint ? chip("🚀 Base instalada", "#FEF3C7", "#92400e") : ""
  ].join("");

  if (modoCuenta === "existente") {
    if (nombre.length < 2) {
      res.innerHTML = `<span class="hist-meta">Escribe el nombre y elige la cuenta de la lista. Si no aparece, usa “✨ Registrar nueva”.</span>`;
    } else if (info) {
      res.innerHTML = `<span class="ok">✓ ${esc(info.nombre)}</span>` + chips(info, "Existente");
      mostrarSeg = !info.segmento; mostrarContactos = true;
      if (mostrarSeg) sub.textContent = "Falta el segmento de esta cuenta: complétalo una vez y quedará guardado en su ficha.";
    } else {
      res.innerHTML = `<span class="warn">⚠ No encontramos “${esc(nombre)}”.</span><button type="button" id="ag-cta-anueva">✨ Registrarla como nueva</button>`;
      $("ag-cta-anueva").addEventListener("click", () => ponerModoCuenta("nueva"));
    }
  } else {
    if (info) {
      res.innerHTML = `<span class="warn">⚠ “${esc(info.nombre)}” ya existe.</span><button type="button" id="ag-cta-aex">Usar la cuenta existente</button>`;
      $("ag-cta-aex").addEventListener("click", () => { $("ag-c-cuenta").value = info.nombre; ponerModoCuenta("existente"); });
    } else {
      res.innerHTML = nombre.length >= 2 ? chips(null, "Nuevo") : `<span class="hist-meta">Escribe el nombre de la cuenta nueva y su segmento.</span>`;
      if (/\s[-–\/]\s?|\s?[-–\/]\s/.test(nombre))
        res.innerHTML += `<span class="warn">⚠ Escribe solo el nombre del cliente: la oportunidad va en su campo (no “Cliente - Proyecto”).</span>`;
      // Posibles duplicados con otro nombre (ej. "Provet" vs "Laboratorios Provet")
      const parecidas = nombre.length >= 3 ? [...indice.values()].filter(x => parecidoCuentas(nombre, x.nombre) >= 0.6).slice(0, 3) : [];
      if (parecidas.length) {
        res.innerHTML += `<span class="warn">¿Es alguna de estas?</span>` + parecidas.map(x => `<button type="button" data-usar="${esc(x.nombre)}">${esc(x.nombre)}</button>`).join("");
        res.querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", () => { $("ag-c-cuenta").value = b.dataset.usar; ponerModoCuenta("existente"); }));
      }
      mostrarSeg = true; mostrarContactos = nombre.length >= 2;
    }
  }
  campos.style.display = mostrarSeg ? "grid" : "none";
  $("ag-ct-wrap").style.display = mostrarContactos ? "block" : "none";
  if (!conservar) poblarContactos(info && modoCuenta === "existente" ? info : null);
  // Oportunidades de esta cuenta (seguimiento). Una cuenta nueva no tiene: pasa a "Nueva".
  if ($("ag-opp-box")) {
    poblarSelectDeals();
    if (!conservar && modoCuenta === "nueva" && modoOpp === "seg") ponerModoOpp("nueva");
    else alCambiarDeal();
  }
  renderHistorialCuenta(info && modoCuenta === "existente" ? info.clave : "");
}

// Copia de los contactos que se pintaron en el selector (así un refresco
// en vivo no cambia a qué contacto apunta cada opción).
let contactosModal = [];
function contactosActuales() { return contactosModal; }

function poblarContactos(info, preferido) {
  const lista = info ? [...info.contactos] : [];
  contactosModal = lista;
  const sel = $("ag-c-contacto");
  sel.innerHTML = `<option value="">— Sin contacto —</option>` +
    lista.map((c, i) => `<option value="c${i}">${esc(c.nombre)}${c.cargo ? " · " + esc(c.cargo) : ""}</option>`).join("") +
    `<option value="__nuevo__">➕ Agregar nuevo contacto</option>`;
  let val = "";
  if (preferido) {
    const i = lista.findIndex(c => normNombre(c.nombre) === normNombre(preferido));
    val = i >= 0 ? "c" + i : "";
  } else if (lista.length) val = "c0";
  else if (modoCuenta === "nueva") val = "__nuevo__";
  sel.value = val;
  ["ag-c-ct-nombre", "ag-c-ct-cargo", "ag-c-ct-correo", "ag-c-ct-tel"].forEach(id => $(id).value = "");
  alCambiarContacto();
}

function alCambiarContacto() {
  const v = $("ag-c-contacto").value;
  $("ag-ct-nuevo").style.display = v === "__nuevo__" ? "grid" : "none";
  const info = $("ag-ct-info");
  if (v && v !== "__nuevo__") {
    const c = contactosActuales()[parseInt(v.slice(1), 10)];
    info.innerHTML = c ? [
      c.cargo ? esc(c.cargo) : "",
      c.correo ? `✉️ <a href="mailto:${esc(c.correo)}">${esc(c.correo)}</a>` : "",
      c.telefono ? `📞 <a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : ""
    ].filter(Boolean).join(" · ") || `<span class="hist-meta">Sin correo ni teléfono registrados.</span>` : "";
  } else info.innerHTML = v === "__nuevo__" ? `<span class="hist-meta">Se guardará en la ficha de la cuenta para las próximas gestiones.</span>` : "";
}

// Contacto elegido en el modal → { contacto, esNuevo } o error
function leerContacto() {
  const v = $("ag-c-contacto").value;
  if ($("ag-ct-wrap").style.display === "none" || !v) return { contacto: null };
  if (v === "__nuevo__") {
    const nombre = $("ag-c-ct-nombre").value.trim();
    const correo = $("ag-c-ct-correo").value.trim();
    if (!nombre) return { error: "Escribe el nombre del contacto o elige “— Sin contacto —”." };
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: "El correo del contacto no es válido." };
    return { contacto: { nombre, cargo: $("ag-c-ct-cargo").value.trim(), correo, telefono: $("ag-c-ct-tel").value.trim() }, esNuevo: true };
  }
  const c = contactosActuales()[parseInt(v.slice(1), 10)];
  return { contacto: c || null };
}

// 🗒 Historial de notas de la cuenta (Gerencia ve todo el equipo;
// un vendedor ve sus propias gestiones, igual que en el resto de la agenda)
function renderHistorialCuenta(clave) {
  const box = $("ag-hist");
  if (!box) return;
  if (!clave) { box.style.display = "none"; box.innerHTML = ""; return; }
  const lista = baseGestiones()
    .filter(g => g.id !== editandoId && idCuenta(g.cuenta) === clave)
    .sort((a, b) => (String(b.fecha || "") + String(b.hora || "")).localeCompare(String(a.fecha || "") + String(a.hora || "")));
  if (!lista.length) {
    box.style.display = "block";
    box.innerHTML = `<div class="hist-tit"><span>🗒 Historial de la cuenta</span></div><div class="hist-it hist-meta">Aún no hay gestiones anteriores${esAdmin() ? "" : " tuyas"} con esta cuenta.</div>`;
    return;
  }
  const visibles = lista.slice(0, histLimite);
  box.style.display = "block";
  box.innerHTML = `<div class="hist-tit"><span>🗒 Historial de la cuenta</span><span class="hist-meta">${lista.length} gestión(es)</span></div>` +
    visibles.map(g => `<div class="hist-it">
      <span class="hist-fecha">${esc(g.fecha || "")}</span>
      <span class="hist-meta"> · ${esc((g.rep || "").split(" ")[0])} · ${esc(g.tipo || "")}${etapaDe(g) ? " · " + esc(etapaDe(g)) : ""}${g.negocio ? " · " + esc(g.negocio) : ""}${g.contactoNombre ? " · 👤 " + esc(g.contactoNombre) : ""}</span>
      <div class="hist-nota">${g.notas ? esc(g.notas) : `<i class="hist-meta">Sin notas</i>`}</div>
    </div>`).join("") +
    (lista.length > histLimite ? `<button type="button" class="hist-mas" id="ag-hist-mas">Ver ${Math.min(10, lista.length - histLimite)} más ▾</button>` : "");
  const mas = $("ag-hist-mas");
  if (mas) mas.addEventListener("click", () => { histLimite += 10; renderHistorialCuenta(clave); });
}

// ═══════════════════════════════════════════
// RENDER GENERAL
// ═══════════════════════════════════════════
function render() {
  renderMiAgenda();
  renderEquipo();
  renderSemana();
  renderMensual();
  renderHistorico();
  renderComparar();
}

// ═══════════════════════════════════════════
// 👤 MI AGENDA (vista personal del rep, como la app original)
// ═══════════════════════════════════════════
function miaMetric(id, lbl, val, sub, style) {
  return `<div class="rep-metric" id="${id}">
    <div class="rep-metric-lbl">${lbl}</div>
    <div class="rep-metric-val" style="${style}">${val}</div>
    <div class="rep-metric-sub">${sub}</div></div>`;
}

function renderMiAgenda() {
  if (esAdmin()) return;
  const cont = $("ag-sub-mia");
  if (!cont) return;
  const u = obtenerUsuario();
  const mias = baseGestiones();
  const hoy = new Date();

  // Semana actual
  const lunes = lunesDe(0);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const desde = claveFecha(lunes), hasta = claveFecha(domingo);
  const sem = mias.filter(g => (g.fecha || "") >= desde && (g.fecha || "") <= hasta);

  // Mes actual
  const mesClave = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}`;
  const mes = mias.filter(g => mesDe(g) === mesClave);
  const mesCom = mes.filter(g => g.tipo === "Comercial");
  const mesOp = mes.filter(g => g.tipo === "Operativo");
  const mesNuevos = mes.filter(g => g.tipoCliente === "Nuevo");
  const cuentasMes = new Set(mes.map(g => String(g.cuenta || "").trim()).filter(Boolean)).size;

  cont.innerHTML = `
    <div class="rep-hero">
      <div>
        <div class="rep-hero-name">👋 ${esc((u.nombreRep || "").split(" ")[0])}</div>
        <div class="rep-hero-sub">${hoy.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      <button class="btn-primario" id="mia-btn-nueva">＋ Registrar gestión</button>
    </div>
    <div class="rep-metrics">
      ${miaMetric("mia-sem", "Esta semana", sem.length, "gestiones", "")}
      ${miaMetric("mia-mes", "Este mes", mes.length, MESES_NOMBRE[hoy.getMonth()] + " " + hoy.getFullYear(), "")}
      ${miaMetric("mia-com", "Comercial", mesCom.length, Math.round(mesCom.length / (mes.length || 1) * 100) + "% del mes", "color:#1d4ed8")}
      ${miaMetric("mia-op", "Operativo", mesOp.length, Math.round(mesOp.length / (mes.length || 1) * 100) + "% del mes", "color:#15803d")}
      ${miaMetric("mia-nue", "Clientes nuevos", mesNuevos.length, "este mes", "color:#d97706")}
      ${miaMetric("mia-cta", "Cuentas únicas", cuentasMes, "este mes", "color:#7c3aed")}
    </div>
    <div class="card">
      <p class="section-lbl">Mi actividad esta semana</p>
      <div style="height:170px;position:relative"><canvas id="mia-ch"></canvas></div>
    </div>
    <div class="card">
      <p class="section-lbl">Mis últimas gestiones (30 días)</p>
      <div id="mia-lista"></div>
    </div>
  `;

  // Botón registrar + métricas clicables (llevan a la vista filtrada)
  $("mia-btn-nueva").addEventListener("click", () => abrirModal(null));
  const irMensual = (tipo, tipoCliente) => {
    filtros.mes = mesClave; filtros.tipo = tipo || ""; filtros.tipoCliente = tipoCliente || "";
    filtros.etapa = ""; filtros.texto = ""; filtros.segmento = ""; filtros.modalidad = ""; filtros.negocio = "";
    $("ag-f-mes").value = mesClave; $("ag-f-tipo").value = filtros.tipo;
    $("ag-f-etapa").value = ""; $("ag-f-texto").value = "";
    $("ag-f-segmento").value = ""; $("ag-f-modalidad").value = ""; $("ag-f-negocio").value = "";
    renderMensual();
    mostrarSub("mes");
  };
  $("mia-sem").addEventListener("click", () => mostrarSub("sem"));
  $("mia-mes").addEventListener("click", () => irMensual("", ""));
  $("mia-com").addEventListener("click", () => irMensual("Comercial", ""));
  $("mia-op").addEventListener("click", () => irMensual("Operativo", ""));
  $("mia-nue").addEventListener("click", () => irMensual("", "Nuevo"));
  $("mia-cta").addEventListener("click", () => irMensual("", ""));

  // Gráfica: mi actividad de la semana (apilada por día)
  const datosCom = [], datosOpe = [], etiquetas = [];
  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
    const clave = claveFecha(dia);
    const delDia = sem.filter(g => g.fecha === clave);
    datosCom.push(delDia.filter(g => g.tipo === "Comercial").length);
    datosOpe.push(delDia.filter(g => g.tipo !== "Comercial").length);
    etiquetas.push(DIAS_NOMBRE[i].slice(0, 3));
  }
  mkChart("mia-ch", {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [
        { label: "Comerciales", data: datosCom, backgroundColor: "#2563EB", borderRadius: 4 },
        { label: "Operativas", data: datosOpe, backgroundColor: "#9b9b96", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { precision: 0 } } }
    }
  });

  // Mis últimas gestiones (30 días)
  const limite = new Date(hoy); limite.setDate(hoy.getDate() - 30);
  const desde30 = claveFecha(limite);
  const ult = mias.filter(g => (g.fecha || "") >= desde30);
  const porFecha = {};
  ult.forEach(g => { const f = g.fecha || "0000-00-00"; (porFecha[f] = porFecha[f] || []).push(g); });
  const fechas = Object.keys(porFecha).sort().reverse();
  $("mia-lista").innerHTML = fechas.length === 0
    ? `<div class="lista-vacia">Aún no tienes gestiones en los últimos 30 días. Usa "＋ Registrar gestión" para cargar tu agenda.</div>`
    : fechas.map(f => `<div class="ag-dia">
        <div class="ag-dia-hdr"><span>${fechaLegible(f)}</span><span>${porFecha[f].length}</span></div>
        ${porFecha[f].sort((a, b) => String(b.hora || "").localeCompare(String(a.hora || ""))).map(itemHtml).join("")}
      </div>`).join("");
  activarBotonesEditar($("mia-lista"));
}

// ═══════════════════════════════════════════
// 👥 EQUIPO (solo Gerencia): tarjeta por rep del mes
// ═══════════════════════════════════════════
function renderEquipo() {
  if (!esAdmin()) return;
  const cont = $("eq-cards");
  if (!cont) return;

  const base = baseGestiones();
  const delMes = eqMes ? base.filter(g => mesDe(g) === eqMes) : base;
  const reps = repsVisibles();
  $("eq-conteo").textContent = `${delMes.length} gestión(es) del equipo en ${nombreMes(eqMes) || "total"}`;

  cont.innerHTML = reps.map((nombre, i) => {
    const suyas = delMes.filter(g => g.rep === nombre);
    const com = suyas.filter(g => g.tipo === "Comercial").length;
    const ope = suyas.filter(g => g.tipo === "Operativo").length;
    const cuentas = new Set(suyas.map(g => String(g.cuenta || "").trim()).filter(Boolean)).size;
    const nuevos = suyas.filter(g => g.tipoCliente === "Nuevo").length;
    const iniciales = nombre.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
    const color = REP_COLORS[i % REP_COLORS.length];
    return `<div class="eq-card" data-rep="${esc(nombre)}">
      <div class="eq-hdr">
        <div class="eq-avatar" style="background:${color}">${iniciales}</div>
        <div class="eq-nombre">${esc(nombre)}</div>
      </div>
      <div class="eq-big" style="color:${color}">${suyas.length}</div>
      <div class="eq-big-sub">gestiones en ${nombreMes(eqMes) || "total"}</div>
      <div class="eq-rows">
        <span>💼 ${com} comerciales</span>
        <span>⚙️ ${ope} operativas</span>
        <span>🏢 ${cuentas} cuentas</span>
        <span>✨ ${nuevos} nuevos</span>
      </div>
      <div class="eq-btns">
        <button class="eq-btn" data-accion="sem">🗓 Ver semana</button>
        <button class="eq-btn" data-accion="mes">📊 Ver mes</button>
      </div>
    </div>`;
  }).join("");

  const irMensualRep = (nombre) => {
    filtros.rep = nombre;
    filtros.mes = eqMes;
    filtros.tipo = ""; filtros.etapa = ""; filtros.tipoCliente = ""; filtros.texto = "";
    filtros.segmento = ""; filtros.modalidad = ""; filtros.negocio = "";
    $("ag-f-rep").value = filtros.rep;
    $("ag-f-mes").value = filtros.mes;
    $("ag-f-tipo").value = ""; $("ag-f-etapa").value = ""; $("ag-f-texto").value = "";
    $("ag-f-segmento").value = ""; $("ag-f-modalidad").value = ""; $("ag-f-negocio").value = "";
    renderMensual();
    mostrarSub("mes");
  };
  const irSemanaRep = (nombre) => {
    semRep = nombre; semTipo = ""; semMod = "";
    semanaOffset = 0;
    $("sem-f-rep").value = nombre;
    renderSemana();
    mostrarSub("sem");
  };

  cont.querySelectorAll(".eq-card").forEach(card => {
    card.addEventListener("click", () => irMensualRep(card.dataset.rep));
    card.querySelectorAll(".eq-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.accion === "sem") irSemanaRep(card.dataset.rep);
        else irMensualRep(card.dataset.rep);
      });
    });
  });
}

// ═══════════════════════════════════════════
// 🗓 SEMANA (con gráfica y tarjetas clicables)
// ═══════════════════════════════════════════
function renderSemana() {
  const lunes = lunesDe(semanaOffset);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const desde = claveFecha(lunes), hasta = claveFecha(domingo);

  $("sem-rango").textContent =
    `${lunes.getDate()} ${MESES_NOMBRE[lunes.getMonth()].slice(0,3)} — ${domingo.getDate()} ${MESES_NOMBRE[domingo.getMonth()].slice(0,3)} ${domingo.getFullYear()}` +
    (semanaOffset === 0 ? " (actual)" : "");

  const enSemana = baseGestiones().filter(g => {
    const f = g.fecha || "";
    return f >= desde && f <= hasta && (!semRep || g.rep === semRep);
  });
  const visibles = enSemana.filter(g =>
    (!semTipo || g.tipo === semTipo) && (!semMod || g.modalidad === semMod));

  const comerciales = enSemana.filter(g => g.tipo === "Comercial");
  const cuentas = new Set(visibles.map(g => String(g.cuenta || "").trim()).filter(Boolean));
  const presenciales = enSemana.filter(g => g.modalidad === "Presencial");

  $("sem-metricas").innerHTML = `
    <div class="m-card clic ${!semTipo && !semMod ? "activa" : ""}" id="sm-todas">
      <div class="m-lbl">Gestiones de la semana</div>
      <div class="m-val" style="color:var(--blue)">${enSemana.length}</div>
      <div class="m-sub">${semRep ? esc(semRep) : "todo el equipo"}</div></div>
    <div class="m-card clic ${semTipo === "Comercial" ? "activa" : ""}" id="sm-com">
      <div class="m-lbl">Comerciales</div>
      <div class="m-val" style="color:var(--green)">${comerciales.length}</div>
      <div class="m-sub">clic para filtrar</div></div>
    <div class="m-card"><div class="m-lbl">Cuentas</div>
      <div class="m-val">${cuentas.size}</div>
      <div class="m-sub">cuentas únicas</div></div>
    <div class="m-card clic ${semMod === "Presencial" ? "activa" : ""}" id="sm-pre">
      <div class="m-lbl">Presenciales</div>
      <div class="m-val" style="color:var(--amber)">${presenciales.length}</div>
      <div class="m-sub">clic para filtrar</div></div>
  `;
  $("sm-todas").addEventListener("click", () => { semTipo = ""; semMod = ""; renderSemana(); });
  $("sm-com").addEventListener("click", () => { semTipo = semTipo === "Comercial" ? "" : "Comercial"; renderSemana(); });
  $("sm-pre").addEventListener("click", () => { semMod = semMod === "Presencial" ? "" : "Presencial"; renderSemana(); });

  $("sem-conteo").textContent = `${visibles.length} gestión(es)`;

  // Gráfica: gestiones por día (comerciales vs operativas apiladas)
  const datosCom = [], datosOpe = [], etiquetas = [];
  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
    const clave = claveFecha(dia);
    const delDia = visibles.filter(g => g.fecha === clave);
    datosCom.push(delDia.filter(g => g.tipo === "Comercial").length);
    datosOpe.push(delDia.filter(g => g.tipo !== "Comercial").length);
    etiquetas.push(`${DIAS_NOMBRE[i].slice(0,3)} ${dia.getDate()}`);
  }
  mkChart("sem-ch", {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [
        { label: "Comerciales", data: datosCom, backgroundColor: "#2563EB", borderRadius: 4 },
        { label: "Operativas", data: datosOpe, backgroundColor: "#9b9b96", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const idx = elems[0].index;
        const dia = new Date(lunes); dia.setDate(lunes.getDate() + idx);
        const ancla = document.getElementById("sem-dia-" + claveFecha(dia));
        if (ancla) ancla.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { precision: 0 } }
      }
    }
  });

  // Los 7 días de la semana, incluyendo días sin gestiones
  let html = "";
  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
    const clave = claveFecha(dia);
    const items = visibles
      .filter(g => g.fecha === clave)
      .sort((a, b) => String(a.hora || "").localeCompare(String(b.hora || "")));
    const esHoy = clave === claveFecha(new Date());
    html += `<div class="ag-dia" id="sem-dia-${clave}">
      <div class="ag-dia-hdr">
        <span>${DIAS_NOMBRE[i]} ${dia.getDate()} ${esHoy ? " · <b style='color:var(--blue)'>HOY</b>" : ""}</span>
        <span>${items.length || ""}</span>
      </div>
      ${items.length ? items.map(itemHtml).join("") :
        `<div style="font-size:12px;color:var(--txt3);padding:8px 4px">Sin gestiones</div>`}
    </div>`;
  }
  $("sem-lista").innerHTML = html;
  activarBotonesEditar($("sem-lista"));
}

// ═══════════════════════════════════════════
// 📊 MENSUAL (interactivo)
// ═══════════════════════════════════════════
// mesForzado: permite calcular lo mismo para otro mes (variación vs mes anterior)
function filtrarMensual(mesForzado) {
  const mes = mesForzado !== undefined ? mesForzado : filtros.mes;
  return baseGestiones().filter(g => {
    if (mes && mesDe(g) !== mes) return false;
    if (filtros.rep && g.rep !== filtros.rep) return false;
    if (filtros.tipo && g.tipo !== filtros.tipo) return false;
    if (filtros.segmento && segDe(g) !== filtros.segmento) return false;
    if (filtros.modalidad && g.modalidad !== filtros.modalidad) return false;
    if (filtros.negocio && g.negocio !== filtros.negocio) return false;
    if (filtros.etapa && etapaDe(g) !== filtros.etapa) return false;
    if (filtros.tipoCliente && g.tipoCliente !== filtros.tipoCliente) return false;
    if (filtros.texto) {
      const blob = [g.cuenta, g.oportunidad, g.ciudad, g.contactoNombre, g.notas].map(x => x || "").join(" ").toLowerCase();
      if (!blob.includes(filtros.texto)) return false;
    }
    return true;
  });
}

// Exporta a CSV las gestiones visibles con los filtros del reporte mensual
function exportarCSVAgenda() {
  const cols = ["fecha","hora","rep","cuenta","oportunidad","tipo","etapa","negocio","tipoCliente","segmento","modalidad","contactoNombre","contactoCargo","contactoCorreo","contactoTelefono","ciudad","notas","dealId"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = filtrarMensual().map(g => cols.map(k => {
    if (k === "etapa") return etapaDe(g);
    if (k === "segmento") return segDe(g);
    return g[k] ?? "";
  }).map(celda).join(";"));
  const csv = "\ufeff" + [cols.join(";"), ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agenda_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`⬇ CSV exportado: ${filas.length} gestiones`);
}

// Gestiones de una lista cuya fecha cae en los días 1..dia de su mes
function hastaDia(lista, dia) { return lista.filter(g => parseInt(String(g.fecha || "").slice(8, 10), 10) <= dia); }
function claveMesHoy() { const h = new Date(); return `${h.getFullYear()}-${pad(h.getMonth() + 1)}`; }
function mesAnterior(clave) {
  const [a, m] = clave.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${pad(m - 1)}`;
}
function mesSumar(clave, n) {
  const [a, m] = clave.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
// "▲ +12%" / "▼ -8%" / "=" con color
function deltaTxt(actual, antes) {
  if (!antes && !actual) return `<span class="eq">=</span>`;
  if (!antes) return `<span class="up">▲ +${actual}</span>`;
  const pct = Math.round((actual - antes) / antes * 100);
  if (pct > 0) return `<span class="up">▲ +${pct}%</span>`;
  if (pct < 0) return `<span class="down">▼ ${pct}%</span>`;
  return `<span class="eq">= 0%</span>`;
}

// Gráfica de composición: barras horizontales apiladas al 100%.
const DIM_COMP = [
  { fila: "Tipo de gestión", clave: "tipo", campo: g => g.tipo, ops: [["Comercial", "#2563EB"], ["Operativo", "#9b9b96"]] },
  { fila: "Modalidad", clave: "negocio", campo: g => g.negocio, ops: [["Venta", "#16a34a"], ["Renta", "#4f46e5"]] },
  { fila: "Reunión", clave: "modalidad", campo: g => g.modalidad, ops: [["Presencial", "#d97706"], ["Virtual", "#0d9488"]] },
  { fila: "Cliente", clave: "tipoCliente", campo: g => g.tipoCliente, ops: [["Nuevo", "#7c3aed"], ["Existente", "#60a5fa"]] },
  { fila: "Segmento", clave: "segmento", campo: g => segDe(g), ops: [["Corporativo", "#1e3a8a"], ["Retail", "#f59e0b"], ["Público", "#dc2626"]] }
];
const SIN_DATO = "#e5e5e0";
function renderComposicion(lista) {
  const filas = DIM_COMP.map(d => d.fila);
  const datasets = [];
  DIM_COMP.forEach((d, fi) => {
    const tot = lista.length || 1;
    let cubiertos = 0;
    d.ops.forEach(([op, color]) => {
      const n = lista.filter(g => d.campo(g) === op).length;
      cubiertos += n;
      const data = filas.map((_, j) => j === fi ? n / tot * 100 : null);
      datasets.push({ label: op, data, n: filas.map((_, j) => j === fi ? n : 0), dim: d, backgroundColor: color, borderWidth: 0, borderSkipped: false, barPercentage: 0.72 });
    });
    const sin = lista.length - cubiertos;
    datasets.push({ label: "Sin dato", data: filas.map((_, j) => j === fi ? sin / tot * 100 : null), n: filas.map((_, j) => j === fi ? sin : 0), dim: null, backgroundColor: SIN_DATO, borderWidth: 0, barPercentage: 0.72 });
  });
  const etiquetas = {
    id: "etiquetasComp",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((bar, j) => {
          const v = ds.data[j];
          if (!v) return;
          const ancho = Math.abs(bar.x - bar.base);
          const txt = `${ds.label} ${Math.round(v)}%`;
          const corto = `${Math.round(v)}%`;
          const w = ctx.measureText(txt).width;
          const t = w + 10 < ancho ? txt : (ctx.measureText(corto).width + 8 < ancho ? corto : "");
          if (!t) return;
          ctx.fillStyle = ds.backgroundColor === SIN_DATO || ds.backgroundColor === "#60a5fa" || ds.backgroundColor === "#f59e0b" ? "#1a1a18" : "#fff";
          ctx.textAlign = "center";
          ctx.fillText(t, (bar.x + bar.base) / 2, bar.y);
        });
      });
      ctx.restore();
    }
  };
  mkChart("ag-ch-comp", {
    type: "bar",
    data: { labels: filas, datasets },
    plugins: [etiquetas],
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const ds = datasets[elems[0].datasetIndex];
        if (!ds.dim) return;
        const clave = ds.dim.clave, val = ds.label;
        filtros[clave] = filtros[clave] === val ? "" : val;
        const sel = { tipo: "ag-f-tipo", negocio: "ag-f-negocio", modalidad: "ag-f-modalidad", segmento: "ag-f-segmento" }[clave];
        if (sel) $(sel).value = filtros[clave];
        renderMensual();
      },
      plugins: {
        legend: { display: false },
        tooltip: { filter: (it) => it.raw != null && it.raw > 0, callbacks: { label: (it) => ` ${it.dataset.label}: ${it.dataset.n[it.dataIndex]} (${Math.round(it.raw)}%)` } }
      },
      scales: {
        x: { stacked: true, max: 100, ticks: { callback: v => v + "%" }, grid: { color: "rgba(0,0,0,.05)" } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 12, weight: 600 } } }
      }
    }
  });
}

function renderMensual() {
  const visibles = filtrarMensual();

  const comerciales = visibles.filter(g => g.tipo === "Comercial");
  const operativas = visibles.filter(g => g.tipo === "Operativo");
  const cuentas = new Set(visibles.map(g => String(g.cuenta || "").trim()).filter(Boolean));
  const clientesNuevos = visibles.filter(g => g.tipoCliente === "Nuevo").length;

  // Variación vs el mes anterior (con los mismos filtros)
  const prevMes = filtros.mes ? mesAnterior(filtros.mes) : "";
  const enCurso = filtros.mes && filtros.mes === claveMesHoy();
  const diaHoy = new Date().getDate();
  // Mes en curso → se compara contra el mes anterior hasta el mismo día
  const prev = prevMes ? (enCurso ? hastaDia(filtrarMensual(prevMes), diaHoy) : filtrarMensual(prevMes)) : null;
  const vs = (actual, fn) => {
    if (!prev) return "";
    const antes = fn(prev);
    return `<div class="m-sub">${deltaTxt(actual, antes)} vs ${MESES_NOMBRE[parseInt(prevMes.slice(5)) - 1].slice(0, 3)}${enCurso ? " al " + diaHoy : ""} (${antes})</div>`;
  };
  const cuentasN = (l) => new Set(l.map(g => normNombre(g.cuenta)).filter(Boolean)).size;

  $("ag-metricas").innerHTML = `
    <div class="m-card clic" id="mc-todas">
      <div class="m-lbl">Gestiones</div>
      <div class="m-val" style="color:var(--blue)">${visibles.length}</div>
      <div class="m-sub">${filtros.mes ? nombreMes(filtros.mes) + (enCurso ? " · en curso" : "") : "todo el histórico"}</div>
      ${vs(visibles.length, l => l.length)}</div>
    <div class="m-card clic ${filtros.tipo === "Comercial" ? "activa" : ""}" id="mc-com">
      <div class="m-lbl">Comerciales</div>
      <div class="m-val" style="color:var(--green)">${comerciales.length}</div>
      ${vs(comerciales.length, l => l.filter(g => g.tipo === "Comercial").length) || `<div class="m-sub">clic para filtrar</div>`}</div>
    <div class="m-card clic ${filtros.tipo === "Operativo" ? "activa" : ""}" id="mc-ope">
      <div class="m-lbl">Operativas</div>
      <div class="m-val" style="color:var(--amber)">${operativas.length}</div>
      ${vs(operativas.length, l => l.filter(g => g.tipo === "Operativo").length) || `<div class="m-sub">clic para filtrar</div>`}</div>
    <div class="m-card"><div class="m-lbl">Cuentas visitadas</div>
      <div class="m-val">${cuentas.size}</div>
      ${vs(cuentasN(visibles), cuentasN) || `<div class="m-sub">cuentas únicas</div>`}</div>
    <div class="m-card clic ${filtros.tipoCliente === "Nuevo" ? "activa" : ""}" id="mc-nue">
      <div class="m-lbl">Clientes nuevos</div>
      <div class="m-val" style="color:var(--purple)">${clientesNuevos}</div>
      ${vs(clientesNuevos, l => l.filter(g => g.tipoCliente === "Nuevo").length) || `<div class="m-sub">clic para filtrar</div>`}</div>
  `;
  $("mc-todas").addEventListener("click", () => {
    filtros.tipo = ""; filtros.tipoCliente = ""; filtros.etapa = ""; filtros.rep = "";
    filtros.segmento = ""; filtros.modalidad = ""; filtros.negocio = "";
    ["ag-f-tipo","ag-f-etapa","ag-f-rep","ag-f-segmento","ag-f-modalidad","ag-f-negocio"].forEach(id => $(id).value = "");
    renderMensual();
  });
  $("mc-com").addEventListener("click", () => {
    filtros.tipo = filtros.tipo === "Comercial" ? "" : "Comercial";
    $("ag-f-tipo").value = filtros.tipo;
    renderMensual();
  });
  $("mc-ope").addEventListener("click", () => {
    filtros.tipo = filtros.tipo === "Operativo" ? "" : "Operativo";
    $("ag-f-tipo").value = filtros.tipo;
    renderMensual();
  });
  $("mc-nue").addEventListener("click", () => {
    filtros.tipoCliente = filtros.tipoCliente === "Nuevo" ? "" : "Nuevo";
    renderMensual();
  });

  const porRep = {};
  visibles.forEach(g => { const r = g.rep || "Sin rep"; porRep[r] = (porRep[r] || 0) + 1; });
  const repLabels = Object.keys(porRep).sort((a, b) => porRep[b] - porRep[a]);
  mkChart("ag-ch-reps", {
    type: "bar",
    data: {
      labels: repLabels.map(r => r.split(" ")[0]),
      datasets: [{ data: repLabels.map(r => porRep[r]), backgroundColor: repLabels.map((_, i) => REP_COLORS[i % REP_COLORS.length]), borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const rep = repLabels[elems[0].index];
        filtros.rep = filtros.rep === rep ? "" : rep;
        $("ag-f-rep").value = filtros.rep;
        renderMensual();
      },
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } }
    }
  });

  const porEtapa = {};
  comerciales.forEach(g => { const e = etapaDe(g); if (e) porEtapa[e] = (porEtapa[e] || 0) + 1; });
  const etapaLabels = ETAPAS.filter(e => porEtapa[e]);
  mkChart("ag-ch-etapas", {
    type: "doughnut",
    data: {
      labels: etapaLabels,
      datasets: [{ data: etapaLabels.map(e => porEtapa[e]), backgroundColor: etapaLabels.map(e => ETAPA_COLORS[e]), borderWidth: 0 }]
    },
    options: {
      cutout: "62%", responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const etapa = etapaLabels[elems[0].index];
        filtros.etapa = filtros.etapa === etapa ? "" : etapa;
        $("ag-f-etapa").value = filtros.etapa;
        renderMensual();
      },
      plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } } }
    }
  });

  // ── Composición 100%: cada fila es una dimensión, cada segmento una opción ──
  renderComposicion(visibles);

  $("ag-conteo").textContent = `${visibles.length} gestión(es)` +
    (filtros.tipoCliente === "Nuevo" ? " · solo clientes nuevos" : "");

  if (visibles.length === 0) {
    $("ag-lista").innerHTML = `<div class="lista-vacia">Sin gestiones con los filtros actuales</div>`;
    return;
  }
  const porFecha = {};
  visibles.forEach(g => { const f = g.fecha || "0000-00-00"; (porFecha[f] = porFecha[f] || []).push(g); });
  const fechas = Object.keys(porFecha).sort().reverse();

  $("ag-lista").innerHTML = fechas.map(f => {
    const items = porFecha[f].sort((a, b) => String(b.hora || "").localeCompare(String(a.hora || "")));
    return `<div class="ag-dia">
      <div class="ag-dia-hdr"><span>${fechaLegible(f)}</span><span>${items.length}</span></div>
      ${items.map(itemHtml).join("")}
    </div>`;
  }).join("");
  activarBotonesEditar($("ag-lista"));
}

// ═══════════════════════════════════════════
// 📈 HISTÓRICO (v5): comparativo de meses del año / año fiscal
// ═══════════════════════════════════════════
// Año fiscal al que pertenece un mes "AAAA-MM". Con FY_INICIO_MES = 1
// coincide con el año calendario; si no, el FY se nombra por el año en que termina.
function fyDe(clave) {
  const [a, m] = clave.split("-").map(Number);
  if (FY_INICIO_MES === 1) return a;
  return m >= FY_INICIO_MES ? a + 1 : a;
}
function mesesFY(fy) {
  const inicio = `${FY_INICIO_MES === 1 ? fy : fy - 1}-${pad(FY_INICIO_MES)}`;
  return Array.from({ length: 12 }, (_, i) => mesSumar(inicio, i));
}
function nombreFY(fy) { return FY_INICIO_MES === 1 ? `Año ${fy}` : `FY ${fy}`; }
function mesCorto(clave) {
  const [a, m] = clave.split("-");
  return MESES_NOMBRE[parseInt(m) - 1].slice(0, 3) + " " + a.slice(2);
}
function calor(ratio, base) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  return `background:rgba(${base},${(0.06 + r * 0.55).toFixed(2)});color:${r > 0.75 ? "#fff" : "var(--txt)"}`;
}

function renderHistorico() {
  if (!$("his-kpis")) return;
  const todas = baseGestiones().filter(g => !hisRep || g.rep === hisRep);
  const hoyClave = claveMesHoy();
  const fys = [...new Set(mesesEnDatos().map(fyDe))].sort((a, b) => b - a);
  if (!fys.length) {
    $("his-kpis").innerHTML = `<div class="lista-vacia">Aún no hay gestiones para construir el histórico.</div>`;
    return;
  }
  if (!hisFY || !fys.includes(hisFY)) hisFY = fys.includes(fyDe(hoyClave)) ? fyDe(hoyClave) : fys[0];
  $("his-fy").innerHTML = fys.map(f => `<option value="${f}" ${f === hisFY ? "selected" : ""}>${nombreFY(f)}</option>`).join("");
  $("his-ind").value = hisInd;
  const ind = INDICADORES[hisInd];

  // Agrupa por mes
  const porMes = {};
  todas.forEach(g => { const m = mesDe(g); if (/^\d{4}-\d{2}$/.test(m)) (porMes[m] = porMes[m] || []).push(g); });
  const lista = (m) => porMes[m] || [];
  const val = (m, f = ind.f) => f(lista(m));

  // Meses del FY con datos: desde el primer mes con gestiones hasta hoy
  const delFY = mesesFY(hisFY);
  const conDatos = delFY.filter(m => lista(m).length);
  const primero = conDatos[0] || delFY[0];
  const meses = delFY.filter(m => m >= primero && m <= hoyClave);
  if (!meses.length) meses.push(primero);
  if (!hisMes || !meses.includes(hisMes)) hisMes = meses.includes(hoyClave) ? hoyClave : meses[meses.length - 1];
  $("his-mes").innerHTML = [...meses].reverse().map(m => `<option value="${m}" ${m === hisMes ? "selected" : ""}>${nombreMes(m)}</option>`).join("");

  // Promedio de los meses CERRADOS (el mes en curso está incompleto)
  const cerrados = meses.filter(m => m < hoyClave);
  const prom = cerrados.length ? cerrados.reduce((s, m) => s + val(m), 0) / cerrados.length : 0;

  // ── KPIs del mes seleccionado ──
  const v = val(hisMes);
  const mAnt = mesAnterior(hisMes);
  const enCurso = hisMes === hoyClave;
  const hoy = new Date();
  // Mes en curso: se compara contra el mes anterior HASTA EL MISMO DÍA
  const vAntCompleto = val(mAnt);
  const vAnt = enCurso ? ind.f(hastaDia(lista(mAnt), hoy.getDate())) : vAntCompleto;
  const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const proy = enCurso ? Math.round(v / hoy.getDate() * diasMes) : null;
  const ranking = [...meses].filter(m => !(m === hoyClave)).sort((a, b) => val(b) - val(a));
  const mejor = ranking[0];
  const ytdMeses = meses.filter(m => m <= hisMes);
  const ytd = ind.f(ytdMeses.flatMap(lista));
  // Mismo mes del FY anterior (aparece solo cuando haya datos de ese año)
  const mAA = mesSumar(hisMes, -12);
  const hayAA = lista(mAA).length > 0;
  const ytdAA = hayAA ? ind.f(ytdMeses.map(m => mesSumar(m, -12)).flatMap(lista)) : 0;

  const kpi = (l, vv, sub, cls = "") => `<div class="his-kpi ${cls}"><div class="l">${l}</div><div class="v">${vv}</div><div class="s">${sub}</div></div>`;
  const quien = hisRep ? esc(hisRep.split(" ")[0]) : (esAdmin() ? "equipo" : "tú");
  $("his-kpis").innerHTML = [
    kpi(`${ind.t} · ${nombreMes(hisMes)}`, v, enCurso ? `mes en curso · día ${hoy.getDate()} de ${diasMes} · ${quien}` : quien, "main"),
    kpi(`vs ${nombreMes(mAnt)}${enCurso ? " al día " + hoy.getDate() : ""}`, deltaTxt(v, vAnt),
      enCurso ? `${vAnt} al ${hoy.getDate()} de ${MESES_NOMBRE[parseInt(mAnt.slice(5)) - 1].toLowerCase()} · mes completo: ${vAntCompleto}` : `${vAnt} el mes anterior`),
    enCurso
      ? kpi(`Proyección al cierre vs promedio`, `${proy} ${cerrados.length ? deltaTxt(proy, Math.round(prom * 10) / 10) : ""}`, cerrados.length ? `si se mantiene el ritmo · promedio ${prom.toFixed(1)} / mes` : "si se mantiene el ritmo actual")
      : kpi(`vs promedio ${nombreFY(hisFY)}`, cerrados.length ? deltaTxt(v, Math.round(prom * 10) / 10) : "—", cerrados.length ? `promedio ${prom.toFixed(1)} / mes (${cerrados.length} meses cerrados)` : "sin meses cerrados aún"),
    mejor ? kpi(`Mejor mes · ${nombreFY(hisFY)}`, `${val(mejor)}`, `${nombreMes(mejor)}${mejor === hisMes ? " · ¡es este mes! 🏆" : ""}`) : "",
    kpi(`Acumulado ${nombreFY(hisFY)} a ${MESES_NOMBRE[parseInt(hisMes.slice(5)) - 1].toLowerCase()}`, ytd, hayAA ? `${deltaTxt(ytd, ytdAA)} vs mismo periodo año anterior (${ytdAA})` : `${ytdMeses.length} mes(es)`),
    hayAA ? kpi(`vs ${nombreMes(mAA)}`, deltaTxt(v, val(mAA)), `${val(mAA)} en el mismo mes del año anterior`) : ""
  ].join("");

  // ── Gráfica mes a mes ──
  $("his-ch-tit").textContent = `${ind.t} — mes a mes · ${nombreFY(hisFY)}${hisRep ? " · " + hisRep : ""}`;
  const etiq = delFY.map(mesCorto);
  const datos = delFY.map(m => (m >= primero && m <= hoyClave) ? val(m) : null);
  const colores = delFY.map(m => m === hisMes ? "#2563EB" : (m === hoyClave ? "rgba(37,99,235,.25)" : "#93c5fd"));
  const hayFYAnt = delFY.some(m => lista(mesSumar(m, -12)).length);
  const datasets = [
    { type: "bar", label: ind.t, data: datos, backgroundColor: colores, borderRadius: 5, order: 2,
      borderColor: delFY.map(m => m === hoyClave ? "#2563EB" : "transparent"), borderWidth: delFY.map(m => m === hoyClave ? 1.5 : 0) },
    { type: "line", label: "Promedio meses cerrados", data: delFY.map(() => cerrados.length ? Math.round(prom * 10) / 10 : null),
      borderColor: "#6b6b67", borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, order: 1 }
  ];
  if (hayFYAnt) datasets.push({ type: "line", label: nombreFY(hisFY - 1), data: delFY.map(m => val(mesSumar(m, -12))),
    borderColor: "#d97706", backgroundColor: "#d97706", borderWidth: 2, pointRadius: 3, tension: 0.3, order: 0 });
  mkChart("evo-ch", {
    data: { labels: etiq, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const m = delFY[elems[0].index];
        if (m >= primero && m <= hoyClave) { hisMes = m; renderHistorico(); }
      },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { afterLabel: (it) => it.datasetIndex === 0 && delFY[it.dataIndex] === hoyClave ? "(mes en curso)" : "" } }
      },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });

  // ── Tabla: todos los indicadores mes a mes (mapa de calor por fila) ──
  const th = meses.map(m => `<th class="mes ${m === hisMes ? "sel" : ""}" data-mes="${m}" title="Analizar ${nombreMes(m)}">${mesCorto(m)}${m === hoyClave ? " ⏳" : ""}</th>`).join("");
  const filas = Object.entries(INDICADORES).map(([k, it]) => {
    const vals = meses.map(m => it.f(lista(m)));
    const max = Math.max(1, ...vals);
    const celdas = vals.map((x, i) => {
      const sub = i > 0 ? `<small>${deltaTxt(x, vals[i - 1])}</small>` : `<small>&nbsp;</small>`;
      return `<td class="${meses[i] === hisMes ? "sel" : ""}" style="${calor(x / max, "37,99,235")}">${x}${sub}</td>`;
    }).join("");
    const cer = meses.filter(m => m < hoyClave);
    const pr = cer.length ? cer.reduce((s, m) => s + it.f(lista(m)), 0) / cer.length : 0;
    return `<tr class="${k === hisInd ? "on" : ""}"><td class="lbl" data-ind="${k}">${it.t}</td>${celdas}
      <td class="tot">${it.f(meses.flatMap(lista))}</td><td class="tot">${cer.length ? pr.toFixed(1) : "—"}</td></tr>`;
  }).join("");
  $("his-tabla").innerHTML = `<tr><th></th>${th}<th>Total</th><th>Prom.*</th></tr>${filas}
    <tr><td colspan="${meses.length + 3}" class="hint" style="text-align:left;padding-top:8px">* Promedio de los meses cerrados. ⏳ = mes en curso (parcial). “Cuentas únicas” del total no es la suma: cuenta cada cliente una vez en el año.</td></tr>`;
  $("his-tabla").querySelectorAll("th.mes").forEach(el => el.addEventListener("click", () => { hisMes = el.dataset.mes; renderHistorico(); }));
  $("his-tabla").querySelectorAll("td.lbl").forEach(el => el.addEventListener("click", () => { hisInd = el.dataset.ind; renderHistorico(); }));

  // ── Rep × mes (solo Gerencia) ──
  const repCard = $("his-rep-card");
  if (!esAdmin()) { repCard.style.display = "none"; return; }
  repCard.style.display = "block";
  $("his-rep-tit").textContent = `${ind.t} por rep, mes a mes · ${nombreFY(hisFY)}`;
  const base = baseGestiones();
  const reps = repsVisibles();
  const matriz = reps.map(r => meses.map(m => ind.f(base.filter(g => g.rep === r && mesDe(g) === m))));
  const maxR = Math.max(1, ...matriz.flat());
  $("his-rep-tabla").innerHTML = `<tr><th></th>${th}<th>Total</th></tr>` + reps.map((r, i) => `<tr>
      <td class="lbl" style="cursor:default">${esc(r.split(" ")[0])}</td>
      ${matriz[i].map((x, j) => `<td class="${meses[j] === hisMes ? "sel" : ""}" style="${calor(x / maxR, "124,58,237")}">${x}</td>`).join("")}
      <td class="tot">${ind.f(base.filter(g => g.rep === r && meses.includes(mesDe(g))))}</td></tr>`).join("");
  $("his-rep-tabla").querySelectorAll("th.mes").forEach(el => el.addEventListener("click", () => { hisMes = el.dataset.mes; renderHistorico(); }));
}

// ═══════════════════════════════════════════
// 🔁 COMPARAR MESES
// ═══════════════════════════════════════════
function statsMes(clave) {
  const del = baseGestiones().filter(g => mesDe(g) === clave);
  const st = { porRep: del.reduce((acc, g) => { const r = g.rep || "Sin rep"; acc[r] = (acc[r] || 0) + 1; return acc; }, {}) };
  Object.entries(INDICADORES).forEach(([k, it]) => st[k] = it.f(del));
  return st;
}

function deltaHtml(a, b) {
  if (b === 0 && a === 0) return `<span class="cmp-delta" style="background:#F3F4F6;color:#6b7280">=</span>`;
  const dif = a - b;
  const pct = b > 0 ? Math.round(dif / b * 100) : 100;
  if (dif > 0) return `<span class="cmp-delta" style="background:#DCFCE7;color:#15803d">▲ +${pct}%</span>`;
  if (dif < 0) return `<span class="cmp-delta" style="background:#FEE2E2;color:#b91c1c">▼ ${pct}%</span>`;
  return `<span class="cmp-delta" style="background:#F3F4F6;color:#6b7280">=</span>`;
}

function renderComparar() {
  if (!cmpA || !cmpB) {
    $("cmp-tabla").innerHTML = `<tr><td class="lista-vacia">Se necesitan al menos dos meses con datos para comparar</td></tr>`;
    return;
  }
  const A = statsMes(cmpA), B = statsMes(cmpB);

  const fila = (nombre, a, b) => `
    <tr><td>${nombre}</td><td><b>${a}</b></td><td><b>${b}</b></td><td>${deltaHtml(a, b)}</td></tr>`;
  $("cmp-tabla").innerHTML = `
    <tr><th></th><th>${nombreMes(cmpA)}</th><th>${nombreMes(cmpB)}</th><th>Variación</th></tr>
    ${Object.entries(INDICADORES).map(([k, it]) => fila(it.t, A[k], B[k])).join("")}
  `;

  const reps = [...new Set([...Object.keys(A.porRep), ...Object.keys(B.porRep)])].sort();
  mkChart("cmp-ch", {
    type: "bar",
    data: {
      labels: reps.map(r => r.split(" ")[0]),
      datasets: [
        { label: nombreMes(cmpA), data: reps.map(r => A.porRep[r] || 0), backgroundColor: "#2563EB", borderRadius: 4 },
        { label: nombreMes(cmpB), data: reps.map(r => B.porRep[r] || 0), backgroundColor: "#9b9b96", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } }
    }
  });
}

// ═══════════════════════════════════════════
// MODAL (con trazabilidad al pipeline)
// ═══════════════════════════════════════════
function abrirModal(g) {
  editandoId = g ? g.id : null;
  $("ag-modal-titulo").textContent = g ? "Editar gestión" : "Registrar gestión";
  $("ag-modal-error").textContent = "";
  if (esAdmin()) $("ag-c-rep").value = g?.rep || "";
  $("ag-c-ciudad").value = CIUDAD_FIJA;
  const hoy = new Date();
  $("ag-c-fecha").value = g?.fecha || claveFecha(hoy);
  $("ag-c-hora").value = g?.hora || `${pad(hoy.getHours())}:${pad(hoy.getMinutes())}`;
  $("ag-c-cuenta").value = g?.cuenta || "";
  $("ag-c-oportunidad").value = "";
  $("ag-c-deal-canal").value = "";
  $("ag-c-segmento").value = g ? segDe(g) : "";
  $("ag-c-negocio").value = NEGOCIOS.includes(g?.negocio) ? g.negocio : "";
  $("ag-c-modalidad").value = g?.modalidad || "";
  // Cuenta: al editar siempre es una cuenta existente
  cuentaOriginal = g?.cuenta || "";
  tipoClienteOriginal = g?.tipoCliente || "";
  histLimite = 8;
  modoCuenta = "existente";
  $("ag-cta-modo-ex").classList.add("on");
  $("ag-cta-modo-nu").classList.remove("on");
  $("ag-c-cuenta").setAttribute("list", "ag-dl-cuenta");
  $("ag-c-cuenta").placeholder = "Escribe para buscar la cuenta…";
  alCambiarCuenta();
  if (g?.contactoNombre) poblarContactos(infoCuenta(g.cuenta), g.contactoNombre);
  else if (g) { $("ag-c-contacto").value = ""; alCambiarContacto(); }
  $("ag-c-tipo").value = g?.tipo || "";
  const esComercial = (g?.tipo === "Comercial");
  $("ag-etapa-wrap").style.display = esComercial ? "flex" : "none";
  $("ag-c-etapa").value = esComercial ? etapaDe(g) : "";
  $("ag-c-notas").value = g?.notas || "";
  // Sprint de Tracción
  $("ag-c-sprint").value = ACCIONES_SPRINT[g?.sprintAccion] ? g.sprintAccion : "";
  $("ag-c-sprint-paso").value = PASOS_RUTA.includes(g?.sprintPaso) ? g.sprintPaso : PASOS_RUTA[0];
  $("ag-c-sprint-decisor").checked = !!g?.sprintDecisor;
  alCambiarSprint();
  $("ag-btn-eliminar").style.display = (g && esAdmin()) ? "inline-block" : "none";

  // Oportunidad: vinculada → Seguimiento; texto viejo sin vínculo → Sin oportunidad
  const vinculada = g?.dealId && deals.some(d => d.id === g.dealId);
  oppLegado = (!vinculada && g?.oportunidad) ? g.oportunidad : "";
  poblarSelectDeals();
  if (vinculada) {
    if (![...$("ag-c-deal").options].some(o => o.value === g.dealId)) {
      const d = deals.find(x => x.id === g.dealId);
      $("ag-c-deal").add(new Option(`${d.oportunidad} — ${d.estado}`, d.id));
    }
    $("ag-c-deal").value = g.dealId;
  }
  ponerModoOpp(vinculada ? "seg" : (g ? "sin" : "seg"));

  $("ag-modal").classList.add("open");
}

// Llamado desde app.js cuando la pestaña Sprint pide registrar un paso.
// datos = { cuenta, rep, paso, oportunidad }
export function abrirGestionDesdeSprint(datos) {
  if (!$("ag-modal")) return;
  abrirModal(null);
  $("ag-c-cuenta").value = datos.cuenta || "";
  alCambiarCuenta();
  oppLegado = datos.oportunidad || "Recontacto base instalada";
  ponerModoOpp("sin");
  $("ag-c-tipo").value = "Comercial";
  $("ag-c-tipo").dispatchEvent(new Event("change"));
  $("ag-c-etapa").value = "Seguimiento";
  if (esAdmin() && datos.rep) $("ag-c-rep").value = datos.rep;
  $("ag-c-sprint").value = "ruta";
  if (PASOS_RUTA.includes(datos.paso)) $("ag-c-sprint-paso").value = datos.paso;
  alCambiarSprint();
}

// Abre el formulario con la cuenta ya elegida (lo pide la ficha de cuenta).
export function abrirGestionParaCuenta(nombre) {
  if (!$("ag-modal")) return;
  abrirModal(null);
  $("ag-c-cuenta").value = nombre || "";
  alCambiarCuenta();
}

// Abre una gestión existente (la pide el panel lateral de la pestaña Sprint).
export function abrirGestionPorId(id) {
  const g = gestiones.find(x => x.id === id);
  if (!g || !$("ag-modal")) return false;
  if (!puedeEditar(g)) { toast("Solo puedes editar tus propias gestiones"); return false; }
  abrirModal(g);
  return true;
}

function alCambiarSprint() {
  $("ag-sprint-ruta").style.display = $("ag-c-sprint").value === "ruta" ? "block" : "none";
}

function cerrarModal() {
  $("ag-modal").classList.remove("open");
  editandoId = null;
}

async function guardar() {
  const err = $("ag-modal-error");
  err.textContent = "";
  const u = obtenerUsuario();

  const rep = esAdmin() ? $("ag-c-rep").value : u.nombreRep;
  const ciudad = CIUDAD_FIJA;
  const fecha = $("ag-c-fecha").value;
  const escrita = $("ag-c-cuenta").value.trim();
  const info = infoCuenta(escrita);
  const negocio = $("ag-c-negocio").value;
  const modalidad = $("ag-c-modalidad").value;
  const tipo = $("ag-c-tipo").value;
  const etapa = $("ag-c-etapa").value;
  const sprintAccion = $("ag-c-sprint").value;

  // ── Cuenta: existente o nueva ──
  if (!escrita) { err.textContent = "Elige la cuenta o registra una nueva."; return; }
  if (modoCuenta === "existente" && !info) {
    err.textContent = "Esa cuenta no existe todavía. Elígela de la lista o usa “✨ Registrar nueva”.";
    return;
  }
  if (modoCuenta === "nueva" && info) {
    err.textContent = `“${info.nombre}” ya existe: usa la cuenta existente.`;
    return;
  }
  const cuenta = info ? info.nombre : escrita;
  const segmento = (info && info.segmento) || $("ag-c-segmento").value;

  // ── Oportunidad: seguimiento / nueva / sin oportunidad ──
  const vinculo = vinculoActual();
  let oportunidad = "";
  if (modoOpp === "seg") {
    const d = deals.find(x => x.id === vinculo);
    if (!d) { err.textContent = "Elige la oportunidad a la que le haces seguimiento, o usa “✨ Nueva oportunidad” / “⚪ Sin oportunidad”."; return; }
    oportunidad = d.oportunidad || "";
  } else if (modoOpp === "nueva") {
    oportunidad = $("ag-c-oportunidad").value.trim().replace(/\s+/g, " ");
    if (oportunidad.length < 2) { err.textContent = "Escribe el nombre de la nueva oportunidad."; return; }
  } else {
    oportunidad = oppLegado || "Sin oportunidad";
  }
  // Tipo de cliente automático: cuenta nueva → Nuevo; existente → Existente.
  // Al editar sin cambiar de cuenta se respeta lo que ya tenía.
  const tipoCliente = (editandoId && tipoClienteOriginal && idCuenta(cuentaOriginal) === idCuenta(cuenta))
    ? tipoClienteOriginal
    : (modoCuenta === "nueva" ? "Nuevo" : "Existente");
  const ct = leerContacto();
  if (ct.error) { err.textContent = ct.error; return; }

  if (!rep || !fecha || !oportunidad || !negocio || !modalidad || !tipo) {
    err.textContent = "Completa todos los campos obligatorios (*).";
    return;
  }
  if (!segmento) {
    err.textContent = "Indica el segmento de la cuenta (Retail, Corporativo o Público).";
    return;
  }
  if (tipo === "Comercial" && !etapa) {
    err.textContent = "Selecciona la etapa comercial.";
    return;
  }

  // ── Trazabilidad con el pipeline ──
  let dealId = null;
  const btn = $("ag-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";

  try {
    if (vinculo === "__nueva__") {
      // Crear la oportunidad nueva en el pipeline
      const valor = parseFloat($("ag-c-deal-valor").value);
      const estado = $("ag-c-deal-estado").value;
      if (isNaN(valor) || !estado) {
        err.textContent = "Para crear la oportunidad en el pipeline indica su estado y su valor.";
        btn.disabled = false; btn.textContent = "💾 Guardar gestión";
        return;
      }
      const dCanal = $("ag-c-deal-canal").value;
      const dOrigen = dCanal === "Indirecto" ? ORIGEN_INDIRECTO : $("ag-c-deal-origen").value;
      const dBroker = dCanal === "Indirecto" ? brokerDe($("ag-c-deal-broker").value) : null;
      if (!dCanal || !dOrigen || (dCanal === "Indirecto" && !dBroker)) {
        err.textContent = "Para la oportunidad nueva elige Canal y Origen" + (dCanal === "Indirecto" ? " y el Broker." : ".");
        btn.disabled = false; btn.textContent = "💾 Guardar gestión";
        return;
      }
      const anioGestion = parseInt(String(fecha).slice(0, 4), 10);
      const pe = probYEsperado(estado, valor, 0.5);
      const resDeal = await crearDeal({
        oportunidad, cuenta, rep, estado, valor,
        prob: pe.prob, esperado: pe.esperado,
        anio_radicacion: isNaN(anioGestion) ? new Date().getFullYear() : anioGestion,
        cuentaId: claveCuenta(cuenta), tipo: negocio, segmento, canal: dCanal, origen: dOrigen,
        broker: dBroker ? dBroker.nombre : "", brokerId: dBroker ? claveCuenta(dBroker.nombre) : "",
        comentarios: "Creada desde una gestión de la agenda"
      });
      if (!resDeal.ok) {
        err.textContent = "No se pudo crear la oportunidad: " + resDeal.error;
        btn.disabled = false; btn.textContent = "💾 Guardar gestión";
        return;
      }
      dealId = resDeal.id;
    } else if (vinculo && tipo !== "Comercial") {
      // Gestión operativa: solo queda asociada a la oportunidad
      dealId = vinculo;
    } else if (vinculo) {
      // Actualizar la oportunidad existente: estado + valor
      // (la cuenta NO se toca: se mantiene la del pipeline)
      const valor = parseFloat($("ag-c-deal-valor").value);
      const estado = $("ag-c-deal-estado").value;
      const cambios = {};
      if (estado) cambios.estado = estado;
      if (!isNaN(valor)) cambios.valor = valor;
      const dealActual = deals.find(d => d.id === vinculo);
      if (dealActual) {
        // Ganada → 100% del valor (prob 100%) · Perdida → 0 ·
        // resto → valor (nuevo o actual) × probabilidad. Se recalcula siempre
        // que cambie el estado o el valor, igual que en el pipeline.
        const estadoFinal = estado || dealActual.estado;
        const valorFinal = !isNaN(valor) ? valor : (parseFloat(dealActual.valor) || 0);
        const pe = probYEsperado(estadoFinal, valorFinal, dealActual.prob);
        cambios.esperado = pe.esperado;
        if (estadoFinal === "Ganado") cambios.prob = pe.prob;
      }
      if (Object.keys(cambios).length) {
        const resDeal = await actualizarDeal(vinculo, cambios);
        if (!resDeal.ok) {
          err.textContent = "No se pudo actualizar la oportunidad: " + resDeal.error;
          btn.disabled = false; btn.textContent = "💾 Guardar gestión";
          return;
        }
      }
      dealId = vinculo;
    }

    // ── Ficha de la cuenta (canal, sector, contactos) ──
    // Si falla (p. ej. reglas sin publicar) la gestión se guarda igual:
    // canal, sector y contacto también quedan copiados en la gestión.
    const cuentaId = (info && info.fichaId) || idCuenta(cuenta);
    let avisoFicha = "";
    const hoyIso = claveFecha(new Date());
    const nuevoCt = ct.esNuevo ? { ...ct.contacto, creadoPor: rep, fecha: hoyIso } : null;
    if (!info || !info.fichaId) {
      const rf = await crearCuenta(cuentaId, {
        nombre: cuenta, segmento, contactos: nuevoCt ? [nuevoCt] : [],
        creadoPor: rep, origen: modoCuenta === "nueva" ? "Agenda · cuenta nueva" : "Agenda · cuenta histórica"
      });
      if (!rf.ok) avisoFicha = rf.error;
    } else {
      const cambios = {};
      if (!normSegmento(fichas.find(f => f.id === info.fichaId)?.segmento)) cambios.segmento = segmento;
      if (Object.keys(cambios).length) {
        const rf = await actualizarCuenta(info.fichaId, cambios);
        if (!rf.ok) avisoFicha = rf.error;
      }
      if (nuevoCt) {
        const rc = await agregarContactoCuenta(info.fichaId, nuevoCt);
        if (!rc.ok) avisoFicha = rc.error;
      }
    }
    if (avisoFicha) console.warn("No se actualizó la ficha de la cuenta:", avisoFicha);

    // ── Guardar la gestión (con la referencia a la oportunidad) ──
    const c = ct.contacto || {};
    const datos = {
      rep, ciudad, fecha, cuenta, oportunidad, tipoCliente, modalidad, tipo,
      negocio, segmento, cuentaId,
      contactoNombre: c.nombre || "", contactoCargo: c.cargo || "",
      contactoCorreo: c.correo || "", contactoTelefono: c.telefono || "",
      hora: $("ag-c-hora").value,
      etapa: tipo === "Comercial" ? etapa : "",
      etapaVenta: tipo === "Comercial" ? etapa : "",
      notas: $("ag-c-notas").value.trim(),
      dealId: dealId,
      sprintAccion: sprintAccion,
      sprintPaso: sprintAccion === "ruta" ? $("ag-c-sprint-paso").value : "",
      sprintDecisor: sprintAccion === "ruta" ? $("ag-c-sprint-decisor").checked : false,
      ts: new Date().toISOString()
    };
    const eraEdicion = !!editandoId;
    const res = eraEdicion ? await actualizarGestion(editandoId, datos) : await crearGestion(datos);
    btn.disabled = false; btn.textContent = "💾 Guardar gestión";
    if (res.ok) {
      cerrarModal();
      toast(vinculo === "__nueva__" ? "✓ Gestión guardada · oportunidad creada en el pipeline"
        : vinculo ? "✓ Gestión guardada · oportunidad del pipeline actualizada"
        : (eraEdicion ? "✓ Gestión actualizada" : "✓ Gestión registrada"));
      if (avisoFicha) setTimeout(() => toast("⚠️ La gestión se guardó, pero no se pudo actualizar la ficha de la cuenta"), 3000);
    }
    else err.textContent = res.error;
  } catch (e) {
    console.error(e);
    btn.disabled = false; btn.textContent = "💾 Guardar gestión";
    err.textContent = "Ocurrió un error al guardar. Intenta de nuevo.";
  }
}

async function eliminar() {
  if (!editandoId) return;
  if (!confirm("¿Eliminar esta gestión? Esta acción no se puede deshacer.")) return;
  const res = await eliminarGestion(editandoId);
  if (res.ok) { cerrarModal(); toast("🗑 Gestión eliminada"); }
  else $("ag-modal-error").textContent = res.error;
}
