// ═══════════════════════════════════════════════════════════
// pipeline-view.js — v5.0
// Cambios v5.0 (nov 2026) · datos precisos:
//  · Cuentas: una sola por cliente aunque esté escrita distinto
//    ("Provet SAS" = "PROVET S.A."): se agrupan con claveCuenta().
//  · Formulario con LISTAS CERRADAS (catalogos.js):
//      Cuenta → solo de la base (o "＋ Crear cuenta" con aviso de duplicados)
//      Tipo → Venta / Renta · Canal → Directo / Indirecto
//      Origen → Directo: Referido, Rep, Gerencia, CRM · Indirecto: Broker
//      Broker → del catálogo de brokers (o "＋ Crear broker")
//      Segmento → Retail / Corporativo / Público (sale de la cuenta)
//  · Carga masiva: cuentas validadas y tipo/canal/origen comunes.
//  · Nueva sub-pestaña 🤝 Brokers y herramienta 🧹 Calidad de datos (Gerencia).
// Cambios v4.3 (nov 2026):
//  · Pestaña 🏢 Cuentas: clic en una cuenta abre la 📇 FICHA 360
//    (cuenta-ficha.js): datos, contactos, ganado/perdido/activo,
//    oportunidades de todos los años, actividad y notas de la agenda.
//  · Buscador para abrir la ficha de CUALQUIER cuenta (también las
//    que aún no tienen oportunidades) y columna "Último contacto".
// Vista del Pipeline con tres sub-pestañas:
//   📈 Dashboard      → forecast vs cuota, embudo, pipeline por
//                       mes, top 10 cuentas y avance de cuota
//   📋 Oportunidades  → filtros completos + tabla + formulario
//   🏢 Cuentas        → consolidado por cliente
//
// Gerencia ve el dashboard del equipo completo; un vendedor ve
// su propio dashboard (solo sus oportunidades y su cuota).
//
// Cambios v4 (oct 2026):
//  1. Perdido → sale del pipeline activo y su valor esperado es 0
//     (se guarda en 0 y además se fuerza en 0 al leer registros viejos).
//     v4.1: Ganado → probabilidad 100% y valor esperado = 100% del valor
//     (formulario, carga masiva, agenda y registros viejos).
//     v4.2: On hold y Perdido ya no suman en NINGUNA gráfica de composición
//     (Segmento, Canal, Origen, Top brokers) ni en el total de Cuentas.
//  2. Dona "Origen": clic en una porción o en un ítem de la leyenda
//     filtra TODO el dashboard por ese origen (clic de nuevo = quitar).
//  3. Nueva gráfica "Top 10 cuentas" con el pipeline completo de cada
//     cuenta, apilado por estado.
//  4. Tipo: solo "Venta" o "Renta" (selector cerrado).
//  5. Selector de año 2026 / 2027 / 2028: cada pantalla muestra
//     ÚNICAMENTE las oportunidades de ese año de radicación.
//  7. Pipeline activo = Identificado, Cotizado, En diseño, Negociación.
//     On hold ya no suma (se muestra aparte, como referencia).
// ═══════════════════════════════════════════════════════════

import { obtenerUsuario, esAdmin } from "./auth-service.js";
import { suscribirDeals, crearDeal, actualizarDeal, eliminarDeal, suscribirCuotas, guardarCuotas } from "./firestore-service.js";
import { abrirFichaCuenta, alCambiarCuentas, nombresCuentas, actividadCuenta, detenerFichaCuenta } from "./cuenta-ficha.js";
import { crearCuenta, actualizarCuenta, crearBroker } from "./firestore-service.js";
import {
  CANALES, ORIGENES_DIRECTO, ORIGEN_INDIRECTO, ORIGENES, SEGMENTOS, SEGMENTO_TXT,
  claveCuenta, parecidoCuentas, normSegmento, canalDeDeal, origenDeDeal
} from "./catalogos.js";
import { alCambiarCatalogo, cuentaDe, nombreOficial, listaCuentas, brokers as listaBrokers, brokerDe, detenerCatalogo } from "./cuentas-store.js";
import { pintarBrokers } from "./brokers-view.js";
import { abrirCalidadDatos } from "./calidad-datos.js";

// ═══════════════════════════════════════════
// ⚙️ CUOTAS — ahora se administran DESDE EL CRM
// Gerencia las edita con el botón "⚙️ Cuotas" y quedan
// guardadas en Firestore (config/cuotas). Estos valores
// son solo el respaldo inicial, usados únicamente hasta
// el primer guardado desde el CRM.
// ═══════════════════════════════════════════
const CUOTAS_DEFECTO = {
  "Patricia Lopera":      4500000000,
  "Clemencia Rodriguez":  4500000000,
  "Ivan Muñoz":           4500000000,
  "Johana Mayo":          5400000000
};
let ANIO_CUOTA = 2026;
let CUOTAS = { ...CUOTAS_DEFECTO };

// ── Años que se pueden consultar (una pantalla por año) ──
const ANIOS_VISTA = [2026, 2027, 2028];
let anioVista = 2026;

// ── Constantes de negocio ──
const ESTADOS = ["Identificado", "Cotizado", "En diseño", "Negociación", "On hold", "Ganado", "Perdido"];
// Pipeline activo: SOLO estas 4 etapas. "On hold" y "Perdido" NO suman.
const ESTADOS_ACTIVOS = new Set(["Identificado", "Cotizado", "En diseño", "Negociación"]);
const ORDEN_EMBUDO = ["Identificado", "Cotizado", "En diseño", "Negociación"];
const COLORES_EMBUDO = ["#6d28d9", "#1d4ed8", "#0f766e", "#15803d"];
const TIPOS = ["Venta", "Renta"];
// Top 10 cuentas: todo el pipeline de la cuenta (menos Perdido), apilado por estado
const TOP_ESTADOS = ["Identificado", "Cotizado", "En diseño", "Negociación", "Ganado", "On hold"];
const TOP_COLORES = {
  "Identificado": "#6d28d9", "Cotizado": "#1d4ed8", "En diseño": "#0f766e",
  "Negociación": "#15803d", "Ganado": "#ca8a04", "On hold": "#cbd5e1"
};
const REPS_BASE = ["Patricia Lopera", "Clemencia Rodriguez", "Ivan Muñoz", "Johana Mayo"];
const RIESGOS = ["Alto", "Medio", "Bajo"];
const MOTIVOS_PERDIDA = ["Precio", "Producto", "Diseño", "Otra area", "tiempos", "Garantia", "Otros"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const EST_STYLE = {
  "Cotizado":     { bg: "#EFF6FF", cl: "#1d4ed8" },
  "Identificado": { bg: "#EDE9FE", cl: "#6d28d9" },
  "Negociación":  { bg: "#DCFCE7", cl: "#15803d" },
  "On hold":      { bg: "#FEF3C7", cl: "#b45309" },
  "En diseño":    { bg: "#CCFBF1", cl: "#0f766e" },
  "Ganado":       { bg: "#DCFCE7", cl: "#15803d" },
  "Perdido":      { bg: "#FEE2E2", cl: "#b91c1c" }
};
const RIESGO_STYLE = {
  "alto": { bg: "#FEE2E2", cl: "#b91c1c" }, "medio": { bg: "#FEF3C7", cl: "#b45309" }, "bajo": { bg: "#DCFCE7", cl: "#15803d" }
};

// ── Estado interno ──
let deals = [];
let parar = null;
let pararCuotas = null;
let pararCat = null;
// Cuenta / broker recién creados desde el formulario (mientras llega el
// snapshot de Firestore, se usan estos datos para no frenar al usuario)
let cuentaNueva = null, brokerNuevo = null;
let confirmarParecida = false, confirmarBrokerParecido = false;
let editandoId = null;
let ordenCampo = "valor", ordenDir = -1;
let charts = {};
// Filtros de MULTISELECCIÓN: cada uno es un conjunto de valores marcados
// (vacío = "Todos"). El texto de búsqueda sigue siendo libre.
// "cuenta" es un filtro exacto (se activa desde el Top 10 o la pestaña Cuentas).
const filtros = {
  texto: "", cuenta: "",
  rep: new Set(), estado: new Set(), tipo: new Set(), canal: new Set(),
  segmento: new Set(), origen: new Set(), riesgo: new Set(), mes: new Set()
};

// ── Utilidades ──
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}
function fmtFull(n) { return "$ " + Math.round(parseFloat(n) || 0).toLocaleString("es-CO"); }
function badge(txt, style) {
  const s = style || EST_STYLE[txt] || { bg: "#F3F4F6", cl: "#374151" };
  return `<span class="badge" style="background:${s.bg};color:${s.cl}">${esc(txt) || "—"}</span>`;
}
function rBadge(r) {
  if (!r) return "—";
  const s = RIESGO_STYLE[String(r).toLowerCase()] || { bg: "#F3F4F6", cl: "#6b7280" };
  return badge(r, s);
}
function puedeEditar(deal) {
  if (esAdmin()) return true;
  const u = obtenerUsuario();
  return u && deal.rep === u.nombreRep;
}
// Base visible según el rol: Gerencia ve todo el pipeline;
// un vendedor SOLO sus propias oportunidades.
function baseDeals() {
  if (esAdmin()) return deals;
  const u = obtenerUsuario();
  return deals.filter(d => d.rep === u?.nombreRep);
}
function valoresUnicos(campo, base = []) {
  const set = new Set(base);
  baseDeals().forEach(d => { const v = d[campo]; if (v !== undefined && v !== null && String(v).trim() !== "") set.add(String(v).trim()); });
  return [...set].sort((a, b) => String(a).localeCompare(String(b), "es"));
}
// ── Regla única de probabilidad y valor esperado según el estado ──
//   Ganado  → probabilidad 100% y esperado = 100% del valor
//   Perdido → esperado 0
//   Resto   → valor × probabilidad
// La usan el formulario, la carga masiva y la lectura de registros viejos.
function probYEsperado(estado, valor, prob) {
  const v = parseFloat(valor) || 0;
  const p = parseFloat(prob) || 0;
  if (estado === "Ganado") return { prob: 1, esperado: Math.round(v) };
  if (estado === "Perdido") return { prob: p, esperado: 0 };
  return { prob: p, esperado: Math.round(v * p) };
}
// Probabilidad a mostrar (una Ganada siempre es 100%)
function probDe(d) {
  return d.estado === "Ganado" ? 1 : (parseFloat(d.prob) || 0);
}
// Valor esperado de un deal (usa el guardado o lo calcula).
// Ganada = 100% del valor y Perdida = 0, aunque el registro viejo
// en Firestore tenga otro número guardado.
function esperadoDe(d) {
  if (d.estado === "Ganado" || d.estado === "Perdido") return probYEsperado(d.estado, d.valor, d.prob).esperado;
  const v = parseFloat(d.valor) || 0, p = parseFloat(d.prob) || 0;
  return (d.esperado != null && !isNaN(parseFloat(d.esperado))) ? parseFloat(d.esperado) : Math.round(v * p);
}
// Tipo normalizado: solo "Venta" o "Renta" ("" si el registro trae otra cosa)
function tipoDe(d) {
  const t = String(d.tipo || "").trim().toLowerCase();
  if (t === "venta") return "Venta";
  if (t === "renta" || t === "alquiler" || t === "arriendo") return "Renta";
  return "";
}
// Segmento (Retail / Corporativo / Público): el de la oportunidad; si no
// lo tiene, el que viene en el campo canal (histórico) o el de la cuenta.
function segmentoDe(d) {
  return normSegmento(d.segmento) || normSegmento(d.canal) || (cuentaDe(d.cuenta)?.segmento || "");
}
// Canal (Directo / Indirecto) y Origen normalizados (catalogos.js)
function canalDe(d) { return canalDeDeal(d); }
function origenDe(d) { return origenDeDeal(d); }
// Nombre del broker como está en el catálogo (o el escrito, si aún no existe)
function brokerNom(d) {
  const b = String(d.broker || "").trim();
  return b ? (brokerDe(b)?.nombre || b) : "";
}
function anioDe(d) {
  // Extrae el año sin importar el formato: 2026, "2026", "2026 ", "2.026"...
  const s = String(d.anio_radicacion ?? "").trim();
  if (!s) return null; // sin año registrado
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}
// Año al que pertenece la oportunidad. Sin año registrado se asume
// del año de cuota en curso (regla del Pipeline original).
function anioEfectivo(d) {
  const a = anioDe(d);
  return a === null ? ANIO_CUOTA : a;
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

// ═══════════════════════════════════════════
// ARRANQUE / PARADA (las llama app.js)
// ═══════════════════════════════════════════
export function iniciarPipeline() {
  // Estado limpio por sesión: sin esto, los filtros del usuario
  // anterior quedarían activos (invisibles) para el siguiente.
  filtros.texto = "";
  filtros.cuenta = "";
  MS_DEFS.forEach(def => filtros[def.clave].clear());
  ordenCampo = "valor"; ordenDir = -1;
  anioVista = ANIOS_VISTA.includes(ANIO_CUOTA) ? ANIO_CUOTA : ANIOS_VISTA[0];
  pintarEstructura();
  if (parar) parar();
  parar = suscribirDeals(
    (lista) => { deals = lista; actualizarOpcionesFiltros(); render(); },
    () => {
      $("pl-sub-dash").innerHTML =
        `<div class="estado-conexion error">✕ No se pudo conectar al Pipeline. Revisa tu conexión o tus permisos.</div>`;
    }
  );
  // Catálogo de cuentas y brokers (listas del formulario y nombres oficiales)
  if (pararCat) pararCat();
  pararCat = alCambiarCatalogo(() => {
    llenarListasForm();
    if ($("pl-modal")?.classList.contains("open")) alCambiarCuentaPl();
    render();
  });
  // Cuotas en vivo desde Firestore (si aún no existen, quedan los valores por defecto)
  if (pararCuotas) pararCuotas();
  pararCuotas = suscribirCuotas((cfg) => {
    if (cfg && cfg.valores && Object.keys(cfg.valores).length) {
      CUOTAS = cfg.valores;
      const a = parseInt(cfg.anio);
      if (!isNaN(a)) ANIO_CUOTA = a;
      actualizarTitulosAnio();
      actualizarOpcionesFiltros();
      render();
    }
  });
}

// Los títulos fijos que mencionan el año se refrescan si el año cambia
function actualizarTitulosAnio() {
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set("lbl-dona", `Forecast vs cuota ${anioVista}`);
  set("lbl-gvp", `Ganado vs Perdido por mes (${anioVista})`);
  set("lbl-cuotas", `Avance de cuota por rep (Ganado ${anioVista})`);
  set("lbl-top10", `Top 10 cuentas — pipeline completo ${anioVista}`);
  document.querySelectorAll(".pl-anio-tab").forEach(b =>
    b.classList.toggle("active", parseInt(b.dataset.anio) === anioVista));
}

export function detenerPipeline() {
  detenerFichaCuenta();
  if (pararCat) { pararCat(); pararCat = null; }
  detenerCatalogo();
  if (parar) { parar(); parar = null; }
  if (pararCuotas) { pararCuotas(); pararCuotas = null; }
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
  deals = [];
}

// ═══════════════════════════════════════════
// MULTISELECCIÓN DE FILTROS (como la app original)
// ═══════════════════════════════════════════
const MS_DEFS = [
  { id: "ms-rep",    clave: "rep",    etiqueta: "Rep",      opciones: () => valoresUnicos("rep", REPS_BASE) },
  { id: "ms-estado", clave: "estado", etiqueta: "Estado",   opciones: () => ESTADOS.slice() },
  { id: "ms-tipo",   clave: "tipo",   etiqueta: "Tipo",     opciones: () => {
      const ops = TIPOS.slice();
      if (baseDeals().some(d => !tipoDe(d))) ops.push("Sin tipo");
      return ops;
    } },
  { id: "ms-canal",  clave: "canal",  etiqueta: "Canal",    opciones: () => {
      const ops = CANALES.slice();
      if (baseDeals().some(d => !canalDe(d))) ops.push("Sin canal");
      return ops;
    } },
  { id: "ms-seg",    clave: "segmento", etiqueta: "Segmento", opciones: () => {
      const ops = SEGMENTOS.slice();
      if (baseDeals().some(d => !segmentoDe(d))) ops.push("Sin segmento");
      return ops;
    } },
  { id: "ms-origen", clave: "origen", etiqueta: "Origen",   opciones: () => {
      const ops = ORIGENES.slice();
      if (baseDeals().some(d => !origenDe(d))) ops.push("Sin origen");
      return ops;
    } },
  { id: "ms-riesgo", clave: "riesgo", etiqueta: "Riesgo",   opciones: () => valoresUnicos("riesgo") },
  { id: "ms-mes",    clave: "mes",    etiqueta: "Mes rad.", opciones: () => MESES.filter(m => valoresUnicos("mes_radicacion").includes(m)) }
];
// (El filtro "Año rad." se reemplazó por el selector 2026 / 2027 / 2028.)
let msListo = false;

function etiquetaMS(def) {
  const set = filtros[def.clave];
  if (!set.size) return `${def.etiqueta}: Todos`;
  if (set.size === 1) {
    const v = [...set][0];
    return `${def.etiqueta}: ${v.length > 14 ? v.slice(0, 13) + "…" : v}`;
  }
  return `${def.etiqueta}: ${set.size} ✓`;
}

function refrescarEtiquetaMS(def) {
  const cont = $(def.id);
  if (!cont) return;
  const btn = cont.querySelector(".ms-btn");
  btn.textContent = etiquetaMS(def);
  btn.classList.toggle("activo", filtros[def.clave].size > 0);
}

// Reconstruye las opciones de cada desplegable con los valores reales
function actualizarMultiselects() {
  MS_DEFS.forEach(def => {
    const cont = $(def.id);
    if (!cont) return;
    const set = filtros[def.clave];
    const ops = def.opciones();
    // Un valor elegido desde una gráfica debe seguir visible en el desplegable
    set.forEach(v => { if (!ops.includes(v)) ops.push(v); });
    const panel = cont.querySelector(".ms-panel");
    panel.innerHTML = ops.length
      ? ops.map((v, i) => `<label class="ms-opt"><input type="checkbox" data-i="${i}" ${set.has(v) ? "checked" : ""}/> ${esc(v)}</label>`).join("")
      : `<div class="ms-opt" style="color:var(--txt3)">Sin valores</div>`;
    panel.querySelectorAll("input").forEach(chk => {
      chk.addEventListener("change", () => {
        const v = ops[parseInt(chk.dataset.i)];
        // Se lee el conjunto "en vivo": las gráficas pueden haberlo reemplazado
        const actual = filtros[def.clave];
        if (chk.checked) actual.add(v); else actual.delete(v);
        refrescarEtiquetaMS(def);
        render();
      });
    });
    refrescarEtiquetaMS(def);
  });
}

function iniciarMultiselects() {
  MS_DEFS.forEach(def => {
    const cont = $(def.id);
    if (!cont) return;
    cont.querySelector(".ms-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const estabaAbierto = cont.classList.contains("open");
      document.querySelectorAll(".ms.open").forEach(x => x.classList.remove("open"));
      if (!estabaAbierto) cont.classList.add("open");
    });
    cont.querySelector(".ms-panel").addEventListener("click", (e) => e.stopPropagation());
  });
  if (!msListo) {
    document.addEventListener("click", () => {
      document.querySelectorAll(".ms.open").forEach(x => x.classList.remove("open"));
    });
    msListo = true;
  }
}

// Clic en un origen (porción de la dona o leyenda) → filtra todo el
// dashboard. Clic de nuevo sobre el mismo origen → quita el filtro.
function toggleOrigen(origen) {
  if (filtros.origen.size === 1 && filtros.origen.has(origen)) filtros.origen = new Set();
  else filtros.origen = new Set([origen]);
  actualizarMultiselects();
  render();
}

// Chips con los filtros que vienen de las gráficas (origen y cuenta),
// para que siempre se vea qué está filtrando y se quite en 1 clic.
function renderChips() {
  const cont = $("pl-chips");
  if (!cont) return;
  const chips = [];
  filtros.origen.forEach(o => chips.push({ tipo: "origen", valor: o, txt: `Origen: ${o}` }));
  if (filtros.cuenta) chips.push({ tipo: "cuenta", valor: filtros.cuenta, txt: `Cuenta: ${filtros.cuenta}` });
  cont.style.display = chips.length ? "flex" : "none";
  cont.innerHTML = chips.map((c, i) =>
    `<button type="button" class="pl-chip" data-i="${i}" title="Quitar filtro">${esc(c.txt)} <span>✕</span></button>`).join("");
  cont.querySelectorAll(".pl-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = chips[parseInt(btn.dataset.i)];
      if (c.tipo === "origen") { filtros.origen.delete(c.valor); actualizarMultiselects(); }
      else filtros.cuenta = "";
      render();
    });
  });
}

// ═══════════════════════════════════════════
// ESTRUCTURA BASE
// ═══════════════════════════════════════════
function pintarEstructura() {
  const u = obtenerUsuario();
  $("page-pipeline").innerHTML = `
    <style>
      .pl-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
      .pl-anio-tabs{display:flex;gap:2px;margin-left:auto;background:var(--s2);border-radius:99px;padding:3px}
      .pl-anio-tab{padding:5px 14px;border-radius:99px;border:none;background:none;font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .pl-anio-tab:hover{color:var(--txt)}
      .pl-anio-tab.active{background:var(--surface);color:var(--txt);box-shadow:0 1px 3px rgba(0,0,0,.12)}
      @media(max-width:820px){.pl-anio-tabs{margin-left:0}}
      .pl-chips{display:none;gap:8px;flex-wrap:wrap;margin:-4px 0 12px}
      .pl-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 12px;border-radius:99px;border:1.5px solid var(--blue);background:var(--blue-l);color:#1d4ed8;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
      .pl-chip span{font-size:11px;opacity:.7}
      .pl-chip:hover span{opacity:1}
      .funnel-hold{margin-top:14px;padding-top:12px;border-top:.5px dashed var(--border)}
      .funnel-hold .funnel-fill{background:#e5e7eb;color:#6b7280}
      .pl-hint-estado{font-size:11px;color:#b91c1c;margin-top:4px;display:none}
      .pl-subtab{padding:6px 14px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .pl-subtab:hover{border-color:var(--blue);color:var(--blue)}
      .pl-subtab.active{background:var(--blue);border-color:var(--blue);color:#fff}
      .pl-g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      @media(max-width:820px){.pl-g2{grid-template-columns:1fr}}
      .funnel-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:12px}
      .funnel-lbl{width:92px;color:var(--txt2);text-align:right;flex-shrink:0}
      .funnel-track{flex:1;background:var(--s2);border-radius:99px;height:24px;overflow:hidden}
      .funnel-fill{height:100%;border-radius:99px;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;padding:0 10px;white-space:nowrap;min-width:fit-content;transition:width .5s ease}
      .funnel-n{width:56px;color:var(--txt3);font-size:11px;flex-shrink:0}
      .cuota-row{padding:10px 0;border-bottom:.5px solid var(--border)}
      .cuota-row:last-child{border-bottom:none}
      .cuota-hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px}
      .cuota-nombre{font-size:13px;font-weight:600}
      .cuota-nums{font-size:11px;color:var(--txt2)}
      .cuota-bar-bg{height:8px;background:var(--s2);border-radius:99px;overflow:hidden}
      .cuota-bar-fill{height:100%;border-radius:99px;transition:width .6s ease}
      .m-card.clic{cursor:pointer;transition:box-shadow .15s,transform .15s}
      .m-card.clic:hover{box-shadow:0 4px 14px rgba(0,0,0,.10);transform:translateY(-2px)}
      .funnel-row.clic{cursor:pointer;border-radius:8px}
      .funnel-row.clic:hover .funnel-lbl{color:var(--blue);font-weight:700}
      .cuota-row.clic{cursor:pointer}
      .cuota-row.clic:hover{background:var(--s2)}
      .hint{font-size:11px;color:var(--txt3);margin:-8px 0 12px}
      .ms{position:relative}
      .ms-btn{padding:8px 30px 8px 12px;font-size:13px;border:.5px solid var(--border);border-radius:99px;background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E") no-repeat right 12px center;color:var(--txt);font-family:inherit;cursor:pointer;white-space:nowrap}
      .ms-btn:hover{border-color:var(--blue)}
      .ms-btn.activo{border-color:var(--blue);color:#1d4ed8;font-weight:600;background-color:var(--blue-l)}
      .ms-panel{display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:400;background:var(--surface);border:.5px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:8px;min-width:200px;max-height:250px;overflow-y:auto}
      .ms.open .ms-panel{display:block}
      .ms-opt{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap}
      .ms-opt:hover{background:var(--s2)}
      .ms-opt input{accent-color:var(--blue);cursor:pointer}
      /* v5 · cuenta y broker con listas cerradas */
      .pl-box{grid-column:1/-1;border:1.5px solid var(--border);border-radius:10px;padding:12px;background:var(--surface)}
      .pl-res{font-size:12px;margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-height:18px}
      .pl-res .ok{color:#15803d;font-weight:600}
      .pl-res .warn{color:#b45309;font-weight:600}
      .pl-res .mut{color:var(--txt3)}
      .pl-res button{border:none;background:var(--blue-l);color:#1d4ed8;font-weight:600;font-size:11px;border-radius:99px;padding:3px 10px;cursor:pointer;font-family:inherit}
      .pl-crear{margin-top:10px;background:var(--s2);border-radius:10px;padding:12px}
      .pl-crear-tit{font-size:12px;font-weight:700;margin-bottom:8px}
      .pl-crear-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
      .pl-mini{font-size:11px;color:var(--txt3);margin-top:3px}
    </style>

    <div class="page-hdr">
      <div>
        <div class="page-title">Pipeline</div>
        <div class="page-sub">${esAdmin() ? "Oportunidades comerciales del equipo" : "Mi pipeline — " + esc(u.nombreRep)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${esAdmin() ? `<button class="btn-secundario" id="pl-btn-calidad">🧹 Calidad de datos</button>` : ""}
        ${esAdmin() ? `<button class="btn-secundario" id="pl-btn-cuotas">⚙️ Cuotas</button>` : ""}
        <button class="btn-secundario" id="pl-btn-masiva">⚡ Carga masiva</button>
        <button class="btn-primario" id="pl-btn-nueva">＋ Nueva oportunidad</button>
      </div>
    </div>

    <div class="pl-subtabs">
      <button class="pl-subtab active" id="pl-st-dash">📈 Dashboard</button>
      <button class="pl-subtab" id="pl-st-tabla">📋 Oportunidades</button>
      <button class="pl-subtab" id="pl-st-ctas">🏢 Cuentas</button>
      <button class="pl-subtab" id="pl-st-brk">🤝 Brokers</button>
      <div class="pl-anio-tabs" id="pl-anio-tabs" title="Cada año muestra únicamente las oportunidades de ese año de radicación">
        ${ANIOS_VISTA.map(a => `<button type="button" class="pl-anio-tab ${a === anioVista ? "active" : ""}" data-anio="${a}">${a}</button>`).join("")}
      </div>
    </div>

    <!-- FILTROS GLOBALES: aplican al Dashboard Y a Oportunidades -->
      <div class="filtros-bar">
        <input class="filtro-input" id="pl-f-texto" placeholder="🔍 Buscar oportunidad, cuenta o broker..."/>
      </div>
      <div class="filtros-bar">
        <div class="ms" id="ms-rep" style="${esAdmin() ? "" : "display:none"}"><button type="button" class="ms-btn">Rep: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-estado"><button type="button" class="ms-btn">Estado: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-tipo"><button type="button" class="ms-btn">Tipo: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-canal"><button type="button" class="ms-btn">Canal: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-seg"><button type="button" class="ms-btn">Segmento: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-origen"><button type="button" class="ms-btn">Origen: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-riesgo"><button type="button" class="ms-btn">Riesgo: Todos</button><div class="ms-panel"></div></div>
        <div class="ms" id="ms-mes"><button type="button" class="ms-btn">Mes rad.: Todos</button><div class="ms-panel"></div></div>
        <button class="btn-secundario" id="pl-f-limpiar" style="padding:7px 12px;font-size:12px">✕ Limpiar</button>
        <span class="filtro-conteo" id="pl-conteo"></span>
      </div>
      <div class="pl-chips" id="pl-chips"></div>

    <!-- ═══ SUB-VISTA: DASHBOARD ═══ -->
    <div id="pl-sub-dash">
      <div class="m-grid" id="dash-cards"></div>
      <p class="hint">💡 Haz clic en las tarjetas, el embudo, los motivos o las barras de cuota para ver esas oportunidades. En la dona de Origen, clic en un origen filtra todo el dashboard. Segmento, Canal, Origen y Brokers suman pipeline activo + ganado (sin On hold ni Perdidas).</p>
      <div id="dash-salud" style="display:none;cursor:pointer;margin-bottom:16px;background:var(--amber-l);color:#92400e;border-radius:var(--r);padding:12px 16px;font-size:13px;font-weight:500"></div>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl" id="lbl-dona">Forecast vs cuota ${anioVista}</p>
          <div style="height:230px;position:relative"><canvas id="ch-forecast"></canvas></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Embudo por estado (pipeline activo)</p>
          <div id="dash-funnel" style="margin-top:14px"></div>
        </div>
      </div>
      <div class="card">
        <p class="section-lbl">Forecast de radicación por mes — Ganado al 100% + esperado del activo (clic en un mes para ver sus oportunidades)</p>
        <div style="height:210px;position:relative"><canvas id="ch-meses"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <p class="section-lbl" id="lbl-top10">Top 10 cuentas — pipeline completo ${anioVista}</p>
        <p class="hint" style="margin:-6px 0 10px">Muestra todas las oportunidades de la cuenta por estado (sin Perdidas), ordenadas por activo + ganado. On hold se ve en gris como referencia: no suma. Clic en una cuenta para ver sus oportunidades.</p>
        <div style="height:340px;position:relative"><canvas id="ch-top10"></canvas></div>
        <div class="lista-vacia" id="top10-vacio" style="display:none">Sin cuentas con oportunidades en esta selección</div>
      </div>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl" id="lbl-gvp">Ganado vs Perdido por mes (${anioVista})</p>
          <div style="height:200px;position:relative"><canvas id="ch-gvp"></canvas></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Motivos de pérdida</p>
          <div style="height:200px;position:relative"><canvas id="ch-motivos"></canvas></div>
        </div>
      </div>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Segmento: Retail vs Corporativo</p>
          <div style="height:200px;position:relative"><canvas id="ch-seg"></canvas></div>
          <div class="hint" id="sum-seg" style="margin:10px 0 0"></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Canal (Directo / Indirecto)</p>
          <div style="height:200px;position:relative"><canvas id="ch-canal"></canvas></div>
          <div class="hint" id="sum-canal" style="margin:10px 0 0"></div>
        </div>
      </div>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Origen de las oportunidades (clic para filtrar todo el dashboard)</p>
          <div style="height:200px;position:relative"><canvas id="ch-origen"></canvas></div>
          <div class="hint" id="sum-origen" style="margin:10px 0 0"></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl">Top brokers (clic para ver sus oportunidades)</p>
          <div style="height:220px;position:relative"><canvas id="ch-brokers"></canvas></div>
          <div class="lista-vacia" id="brokers-vacio" style="display:none">Sin oportunidades con broker registrado en esta selección</div>
        </div>
      </div>
      <div class="card" id="dash-cuotas-card">
        <p class="section-lbl" id="lbl-cuotas">Avance de cuota por rep (Ganado ${anioVista})</p>
        <div id="dash-cuotas"></div>
      </div>
    </div>

    <!-- ═══ SUB-VISTA: OPORTUNIDADES (tabla) ═══ -->
    <div id="pl-sub-tabla" style="display:none">
      <div class="m-grid" id="pl-metricas"></div>
      <p class="hint" id="pl-scope-note" style="margin:-8px 0 12px"></p>

      <div class="card" style="padding:0 16px 8px">
        <div style="display:flex;justify-content:flex-end;padding:10px 0 2px">
          <button class="btn-secundario" id="pl-btn-csv" style="padding:6px 12px;font-size:12px">⬇ Exportar CSV</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl" id="pl-tabla">
            <thead>
              <tr>
                <th data-orden="oportunidad">Oportunidad <span class="sort-ico"></span></th>
                <th data-orden="cuenta">Cuenta <span class="sort-ico"></span></th>
                <th data-orden="rep">Rep <span class="sort-ico"></span></th>
                <th data-orden="estado">Estado <span class="sort-ico"></span></th>
                <th data-orden="valor" style="text-align:right">Valor <span class="sort-ico"></span></th>
                <th data-orden="esperado" style="text-align:right">Esperado <span class="sort-ico"></span></th>
                <th data-orden="prob" style="text-align:right">Prob. <span class="sort-ico"></span></th>
                <th data-orden="riesgo">Riesgo <span class="sort-ico"></span></th>
                <th data-orden="mes_radicacion">Radicación <span class="sort-ico"></span></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="pl-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ SUB-VISTA: CUENTAS (consolidado por cliente) ═══ -->
    <div id="pl-sub-ctas" style="display:none">
      <div class="m-grid" id="ctas-metricas"></div>
      <div class="filtros-bar">
        <input class="filtro-input" id="ctas-buscar" list="ctas-dl" placeholder="📇 Buscar cualquier cuenta para abrir su ficha (también sin oportunidades)…" style="flex:1;min-width:220px" autocomplete="off"/>
        <datalist id="ctas-dl"></datalist>
        <button class="btn-primario" id="ctas-abrir" style="padding:8px 14px;font-size:12px">📇 Abrir ficha</button>
      </div>
      <p class="hint">💡 Haz clic en una cuenta para abrir su ficha completa: datos, contactos, oportunidades ganadas y perdidas, actividad y notas. La tabla respeta los filtros globales.</p>
      <div class="card" style="padding:0 16px 8px">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>
              <th>Cuenta</th>
              <th style="text-align:right">Oportunidades</th>
              <th style="text-align:right" title="Pipeline activo + Ganado (sin On hold ni Perdidas)">Valor total</th>
              <th style="text-align:right">Pipeline activo</th>
              <th style="text-align:right">Esperado</th>
              <th style="text-align:right">Ganado</th>
              <th style="text-align:right" title="Última gestión registrada en la Agenda">Último contacto</th>
            </tr></thead>
            <tbody id="ctas-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ SUB-VISTA: BROKERS (catálogo) ═══ -->
    <div id="pl-sub-brk" style="display:none"></div>

    <!-- MODAL CREAR/EDITAR -->
    <div class="modal-overlay" id="pl-modal">
      <div class="modal-box">
        <div class="modal-hdr">
          <span class="modal-title" id="pl-modal-titulo">Nueva oportunidad</span>
          <button class="modal-close" id="pl-modal-cerrar">×</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group full"><label class="form-label">Oportunidad *</label>
              <input class="form-input" id="pl-c-oportunidad" placeholder="Nombre de la oportunidad"/></div>
            <!-- 🏢 CUENTA: solo de la base (o crear una nueva) -->
            <div class="pl-box">
              <label class="form-label">Cuenta / Cliente *</label>
              <input class="form-input" id="pl-c-cuenta" list="pl-dl-cuenta" placeholder="Escribe para buscar la cuenta…" autocomplete="off" style="width:100%"/>
              <datalist id="pl-dl-cuenta"></datalist>
              <div class="pl-res" id="pl-cta-res"></div>
              <div class="pl-crear" id="pl-cta-crear" style="display:none">
                <div class="pl-crear-tit">＋ Crear cuenta nueva</div>
                <div class="form-grid">
                  <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="pl-nc-nombre" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Segmento *</label>
                    <select class="form-select" id="pl-nc-seg"><option value="">— Selecciona —</option>${SEGMENTOS.map(x => `<option value="${x}">${SEGMENTO_TXT[x]}</option>`).join("")}</select></div>
                </div>
                <div class="pl-res" id="pl-nc-aviso"></div>
                <div class="pl-crear-btns"><button type="button" class="btn-secundario" id="pl-nc-cancelar">Cancelar</button><button type="button" class="btn-primario" id="pl-nc-ok">Crear cuenta</button></div>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Rep *</label>
              <select class="form-select" id="pl-c-rep"></select></div>
            <div class="form-group"><label class="form-label">Estado *</label>
              <select class="form-select" id="pl-c-estado">
                <option value="">Seleccionar...</option>
                ${ESTADOS.map(e => `<option>${e}</option>`).join("")}
              </select>
              <div class="pl-hint-estado" id="pl-hint-estado"></div></div>
            <div class="form-group"><label class="form-label">Valor (COP) *</label>
              <input class="form-input" id="pl-c-valor" type="number" min="0" placeholder="0"/></div>
            <div class="form-group"><label class="form-label">Probabilidad (%)</label>
              <input class="form-input" id="pl-c-prob" type="number" min="0" max="100" placeholder="50"/></div>
            <div class="form-group"><label class="form-label">Tipo *</label>
              <select class="form-select" id="pl-c-tipo">
                <option value="">— Selecciona —</option>
                ${TIPOS.map(t => `<option>${t}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Segmento *</label>
              <select class="form-select" id="pl-c-segmento">
                <option value="">— Selecciona —</option>
                ${SEGMENTOS.map(x => `<option value="${x}">${SEGMENTO_TXT[x]}</option>`).join("")}
              </select>
              <div class="pl-mini" id="pl-seg-nota"></div></div>
            <div class="form-group"><label class="form-label">Canal *</label>
              <select class="form-select" id="pl-c-canal">
                <option value="">— Selecciona —</option>
                ${CANALES.map(x => `<option>${x}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Origen *</label>
              <select class="form-select" id="pl-c-origen"></select></div>
            <!-- 🤝 BROKER (solo canal Indirecto) -->
            <div class="pl-box" id="pl-brk-wrap" style="display:none">
              <label class="form-label">Broker *</label>
              <div style="display:flex;gap:8px">
                <select class="form-select" id="pl-c-broker" style="flex:1;min-width:0"></select>
                <button type="button" class="btn-secundario" id="pl-nb-abrir" style="white-space:nowrap;font-size:12px">＋ Crear broker</button>
              </div>
              <div class="pl-res" id="pl-brk-res"></div>
              <div class="pl-crear" id="pl-brk-crear" style="display:none">
                <div class="pl-crear-tit">＋ Crear broker</div>
                <div class="form-grid">
                  <div class="form-group"><label class="form-label">Nombre del broker *</label><input class="form-input" id="pl-nb-nombre" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Empresa</label><input class="form-input" id="pl-nb-empresa" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Persona de contacto</label><input class="form-input" id="pl-nb-contacto" maxlength="120"/></div>
                  <div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="pl-nb-correo" type="email" maxlength="160"/></div>
                  <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="pl-nb-tel" type="tel" maxlength="40"/></div>
                  <div class="form-group"><label class="form-label">Notas</label><input class="form-input" id="pl-nb-notas" maxlength="300"/></div>
                </div>
                <div class="pl-res" id="pl-nb-aviso"></div>
                <div class="pl-crear-btns"><button type="button" class="btn-secundario" id="pl-nb-cancelar">Cancelar</button><button type="button" class="btn-primario" id="pl-nb-ok">Crear broker</button></div>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Riesgo</label>
              <select class="form-select" id="pl-c-riesgo">
                <option value="">—</option>
                ${RIESGOS.map(r => `<option>${r}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Mes inicio</label>
              <select class="form-select" id="pl-c-mes-inicio">
                <option value="">—</option>
                ${MESES.map(m => `<option>${m}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Mes radicación</label>
              <select class="form-select" id="pl-c-mes">
                <option value="">—</option>
                ${MESES.map(m => `<option>${m}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Año radicación</label>
              <select class="form-select" id="pl-c-anio">
                ${ANIOS_VISTA.map(a => `<option value="${a}">${a}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Motivo pérdida</label>
              <select class="form-select" id="pl-c-motivo">
                <option value="">—</option>
                ${MOTIVOS_PERDIDA.map(m => `<option>${m}</option>`).join("")}
              </select></div>
            <div class="form-group full"><label class="form-label">Comentarios</label>
              <input class="form-input" id="pl-c-comentarios" placeholder="Notas adicionales"/></div>
          </div>
          <div class="login-error" id="pl-modal-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-peligro" id="pl-btn-eliminar" style="display:none">🗑 Eliminar</button>
          <button class="btn-secundario" id="pl-btn-cancelar">Cancelar</button>
          <button class="btn-primario" id="pl-btn-guardar">💾 Guardar</button>
        </div>
      </div>
    </div>

    <!-- MODAL DE CUOTAS (solo Gerencia) -->
    <div class="modal-overlay" id="ct-modal">
      <div class="modal-box" style="max-width:540px">
        <div class="modal-hdr">
          <span class="modal-title">⚙️ Cuotas del equipo</span>
          <button class="modal-close" id="ct-cerrar">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group" style="max-width:150px;margin-bottom:14px">
            <label class="form-label">Año de cuota</label>
            <input class="form-input" id="ct-anio" type="number" min="2020" max="2100"/>
          </div>
          <label class="form-label" style="display:block;margin-bottom:8px">Cuota por representante (COP)</label>
          <div id="ct-filas"></div>
          <button class="btn-secundario" id="ct-agregar" style="margin-top:10px;font-size:12px;padding:7px 12px">＋ Agregar rep</button>
          <div class="login-error" id="ct-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secundario" id="ct-cancelar">Cancelar</button>
          <button class="btn-primario" id="ct-guardar">💾 Guardar cuotas</button>
        </div>
      </div>
    </div>

    <!-- MODAL CARGA MASIVA DE OPORTUNIDADES -->
    <div class="modal-overlay" id="ml-modal">
      <div class="modal-box" style="max-width:960px">
        <div class="modal-hdr">
          <span class="modal-title">⚡ Carga masiva de oportunidades</span>
          <button class="modal-close" id="ml-cerrar">×</button>
        </div>
        <div class="modal-body">
          <p class="hint" style="margin:0 0 10px">Estos datos se aplican a todas las filas. Las cuentas deben existir en la base (si falta alguna, créala desde ＋ Nueva oportunidad).</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px">
            ${esAdmin() ? `<div class="form-group"><label class="form-label">Rep *</label><select class="form-select" id="ml-rep"></select></div>` : ""}
            <div class="form-group"><label class="form-label">Tipo *</label><select class="form-select" id="ml-tipo"><option value="">—</option>${TIPOS.map(t => `<option>${t}</option>`).join("")}</select></div>
            <div class="form-group"><label class="form-label">Canal *</label><select class="form-select" id="ml-canal"><option value="">—</option>${CANALES.map(t => `<option>${t}</option>`).join("")}</select></div>
            <div class="form-group"><label class="form-label">Origen *</label><select class="form-select" id="ml-origen"></select></div>
            <div class="form-group" id="ml-brk-wrap" style="display:none"><label class="form-label">Broker *</label><select class="form-select" id="ml-broker"></select></div>
          </div>
          <div style="display:grid;grid-template-columns:2fr 2fr 1.2fr 1.1fr .7fr 1.1fr 34px;gap:8px;font-size:10px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">
            <span>Oportunidad *</span><span>Cuenta *</span><span>Estado</span><span>Valor (COP) *</span><span>Prob %</span><span>Mes rad.</span><span></span>
          </div>
          <div id="ml-filas"></div>
          <button class="btn-secundario" id="ml-agregar" style="margin-top:10px;font-size:12px;padding:7px 12px">＋ Agregar fila</button>
          <div class="login-error" id="ml-error"></div>
        </div>
        <div class="modal-footer">
          <span class="filtro-conteo" id="ml-conteo" style="margin-right:auto"></span>
          <button class="btn-secundario" id="ml-cancelar">Cancelar</button>
          <button class="btn-primario" id="ml-guardar">💾 Crear oportunidades</button>
        </div>
      </div>
    </div>
  `;

  // Sub-pestañas
  $("pl-st-dash").addEventListener("click", () => mostrarSub("dash"));
  $("pl-st-tabla").addEventListener("click", () => mostrarSub("tabla"));
  $("pl-st-ctas").addEventListener("click", () => mostrarSub("ctas"));
  $("ctas-abrir").addEventListener("click", abrirDesdeBuscador);
  $("ctas-buscar").addEventListener("keydown", (e) => { if (e.key === "Enter") abrirDesdeBuscador(); });
  // Elegir una opción de la lista abre la ficha de inmediato
  $("ctas-buscar").addEventListener("input", (e) => {
    if (e.inputType === "insertReplacementText" || e.inputType === undefined) {
      const v = e.target.value.trim().toLowerCase();
      if (cuentaDe(v)) abrirDesdeBuscador();
    }
  });
  alCambiarCuentas(() => { llenarBuscadorCuentas(); renderCuentas(); });

  // Selector de año: cada pantalla muestra SOLO ese año de radicación
  $("pl-anio-tabs").querySelectorAll(".pl-anio-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      anioVista = parseInt(btn.dataset.anio);
      actualizarTitulosAnio();
      actualizarOpcionesFiltros();
      render();
    });
  });

  // Rep del formulario: un vendedor solo puede elegirse a sí mismo
  const selRep = $("pl-c-rep");
  if (esAdmin()) {
    selRep.innerHTML = `<option value="">Seleccionar...</option>` +
      REPS_BASE.map(r => `<option>${r}</option>`).join("");
  } else {
    selRep.innerHTML = `<option>${esc(u.nombreRep)}</option>`;
    selRep.disabled = true;
  }

  // Eventos generales
  $("pl-btn-nueva").addEventListener("click", () => abrirModal(null));
  $("pl-modal-cerrar").addEventListener("click", cerrarModal);
  $("pl-btn-cancelar").addEventListener("click", cerrarModal);
  $("pl-btn-guardar").addEventListener("click", guardar);
  $("pl-btn-eliminar").addEventListener("click", eliminar);
  $("pl-c-estado").addEventListener("change", actualizarHintEstado);
  // Cuenta / canal / broker con listas cerradas
  $("pl-c-cuenta").addEventListener("input", () => { confirmarParecida = false; alCambiarCuentaPl(); });
  $("pl-c-canal").addEventListener("change", alCambiarCanal);
  $("pl-nc-nombre").addEventListener("input", () => { confirmarParecida = false; avisoCuentaNueva(); });
  $("pl-nc-cancelar").addEventListener("click", () => { $("pl-cta-crear").style.display = "none"; });
  $("pl-nc-ok").addEventListener("click", crearCuentaDesdeForm);
  $("pl-nb-abrir").addEventListener("click", () => abrirCrearBroker(""));
  $("pl-nb-nombre").addEventListener("input", () => { confirmarBrokerParecido = false; avisoBrokerNuevo(); });
  $("pl-nb-cancelar").addEventListener("click", () => { $("pl-brk-crear").style.display = "none"; });
  $("pl-nb-ok").addEventListener("click", crearBrokerDesdeForm);
  $("pl-c-broker").addEventListener("change", () => { $("pl-brk-res").innerHTML = ""; });
  $("ml-canal").addEventListener("change", () => {
    poblarOrigen("ml-origen", $("ml-canal").value, $("ml-origen").value);
    $("ml-brk-wrap").style.display = $("ml-canal").value === "Indirecto" ? "flex" : "none";
  });
  $("pl-st-brk").addEventListener("click", () => mostrarSub("brk"));
  if (esAdmin()) $("pl-btn-calidad").addEventListener("click", abrirCalidadDatos);

  // Modal de cuotas (solo Gerencia)
  if (esAdmin()) {
    $("pl-btn-cuotas").addEventListener("click", abrirModalCuotas);
    $("ct-cerrar").addEventListener("click", () => $("ct-modal").classList.remove("open"));
    $("ct-cancelar").addEventListener("click", () => $("ct-modal").classList.remove("open"));
    $("ct-agregar").addEventListener("click", () => {
      $("ct-filas").insertAdjacentHTML("beforeend", ctFila("", ""));
    });
    $("ct-filas").addEventListener("click", (e) => {
      if (e.target.classList.contains("ct-quitar")) e.target.closest(".ct-fila").remove();
    });
    $("ct-guardar").addEventListener("click", guardarCuotasUI);
  }

  // Carga masiva (todos los roles)
  $("pl-btn-masiva").addEventListener("click", abrirModalMasiva);
  $("ml-cerrar").addEventListener("click", () => $("ml-modal").classList.remove("open"));
  $("ml-cancelar").addEventListener("click", () => $("ml-modal").classList.remove("open"));
  $("ml-agregar").addEventListener("click", () => {
    $("ml-filas").insertAdjacentHTML("beforeend", mlFila());
    actualizarConteoML();
  });
  $("ml-filas").addEventListener("click", (e) => {
    if (e.target.classList.contains("ml-quitar")) {
      e.target.closest(".ml-fila").remove();
      actualizarConteoML();
    }
  });
  $("ml-guardar").addEventListener("click", guardarMasiva);

  // Eventos de filtros
  $("pl-f-texto").addEventListener("input", (e) => { filtros.texto = e.target.value.toLowerCase(); render(); });
  iniciarMultiselects();
  $("pl-f-limpiar").addEventListener("click", () => {
    filtros.texto = "";
    filtros.cuenta = "";
    $("pl-f-texto").value = "";
    MS_DEFS.forEach(def => filtros[def.clave].clear());
    actualizarMultiselects();
    render();
  });
  $("pl-btn-csv").addEventListener("click", exportarCSV);

  // Ordenamiento por encabezado
  $("pl-tabla").querySelectorAll("th[data-orden]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const campo = th.dataset.orden;
      if (ordenCampo === campo) ordenDir = -ordenDir;
      else { ordenCampo = campo; ordenDir = -1; }
      renderTabla();
    });
  });
}

function mostrarSub(nombre) {
  $("pl-st-dash").classList.toggle("active", nombre === "dash");
  $("pl-st-tabla").classList.toggle("active", nombre === "tabla");
  $("pl-st-ctas").classList.toggle("active", nombre === "ctas");
  $("pl-sub-dash").style.display = nombre === "dash" ? "block" : "none";
  $("pl-sub-tabla").style.display = nombre === "tabla" ? "block" : "none";
  $("pl-sub-ctas").style.display = nombre === "ctas" ? "block" : "none";
  $("pl-st-brk").classList.toggle("active", nombre === "brk");
  $("pl-sub-brk").style.display = nombre === "brk" ? "block" : "none";
  if (nombre === "brk") renderBrokers();
}

function actualizarOpcionesFiltros() {
  actualizarMultiselects();

  // El selector de Rep del formulario (Gerencia) incluye a todo
  // rep con cuota: agregar un rep en ⚙️ Cuotas lo habilita aquí.
  const selRepForm = $("pl-c-rep");
  if (selRepForm && esAdmin()) {
    const actualRep = selRepForm.value;
    const nombres = [...new Set([...REPS_BASE, ...Object.keys(CUOTAS)])].sort((a, b) => a.localeCompare(b, "es"));
    selRepForm.innerHTML = `<option value="">Seleccionar...</option>` +
      nombres.map(r => `<option ${r === actualRep ? "selected" : ""}>${esc(r)}</option>`).join("");
  }

  llenarListasForm();
}

// ═══════════════════════════════════════════
// RENDER GENERAL
// ═══════════════════════════════════════════
function render() {
  renderChips();
  renderDashboard();
  renderTabla();
  renderCuentas();
  renderBrokers();
}

// Salta a la pestaña Oportunidades con un filtro de estado aplicado.
// "estado" puede ser un texto, una lista de estados o vacío (= todos).
function irATablaFiltrada(estado, rep) {
  const lista = Array.isArray(estado) ? estado : (estado ? [estado] : []);
  filtros.estado = new Set(lista);
  if (rep !== undefined) filtros.rep = new Set(rep ? [rep] : []);
  actualizarMultiselects();
  render();
  mostrarSub("tabla");
}

// Exporta a CSV lo que esté visible con los filtros actuales
// (separador ; para que Excel en español lo abra directo)
function exportarCSV() {
  const cols = ["oportunidad","cuenta","rep","estado","valor","esperado","prob_pct","riesgo","tipo","canal","origen","segmento","broker","mes_inicio","mes_radicacion","anio_radicacion","motivo_perdida","comentarios"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = filtrarDeals().map(d => cols.map(k => {
    if (k === "esperado") return esperadoDe(d);
    if (k === "prob_pct") return Math.round(probDe(d) * 100);
    if (k === "anio_radicacion") return anioEfectivo(d);
    if (k === "tipo") return tipoDe(d) || (d.tipo ?? "");
    if (k === "cuenta") return nombreOficial(d.cuenta);
    if (k === "canal") return canalDe(d);
    if (k === "origen") return origenDe(d);
    if (k === "segmento") return segmentoDe(d);
    if (k === "broker") return brokerNom(d);
    return d[k] ?? "";
  }).map(celda).join(";"));
  const csv = "\ufeff" + [cols.join(";"), ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pipeline_" + anioVista + "_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`⬇ CSV exportado: ${filas.length} oportunidades`);
}

// ═══════════════════════════════════════════
// DASHBOARD (gráficas)
// ═══════════════════════════════════════════
function renderDashboard() {
  const u = obtenerUsuario();
  // Universo del dashboard: rol + filtros globales + año seleccionado
  // (filtrarDeals ya deja solo el año que se está viendo).
  const propios = filtrarDeals();
  const delAnio = propios;

  const activos = delAnio.filter(d => ESTADOS_ACTIVOS.has(d.estado));
  const enHold = delAnio.filter(d => d.estado === "On hold");
  const ganados = delAnio.filter(d => d.estado === "Ganado");
  const perdidos = delAnio.filter(d => d.estado === "Perdido");
  const vActivo = activos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vHold = enHold.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vGanado = ganados.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vPerdido = perdidos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vEsp = activos.reduce((s, d) => s + esperadoDe(d), 0);

  // Las cuotas de ⚙️ Cuotas aplican a UN año (ANIO_CUOTA).
  // En los demás años no hay cuota definida → el forecast se muestra como "—".
  const hayCuotaAnio = anioVista === ANIO_CUOTA;
  const repsFiltrados = [...filtros.rep];
  const cuota = !hayCuotaAnio ? 0 : (!esAdmin()
    ? (CUOTAS[u.nombreRep] || 0)
    : (repsFiltrados.length
        ? repsFiltrados.reduce((s, n) => s + (CUOTAS[n] || 0), 0)
        : Object.values(CUOTAS).reduce((s, c) => s + c, 0)));
  const fPct = cuota > 0 ? Math.round((vGanado + vEsp) / cuota * 100) : 0;
  const colorF = cuota === 0 ? "#9b9b96" : fPct >= 100 ? "#16a34a" : fPct >= 80 ? "#d97706" : "#dc2626";

  // 🩺 Salud de datos (solo Gerencia): huecos del año en pantalla
  const salud = $("dash-salud");
  if (salud) {
    const delAnioBase = baseDeals().filter(d => anioEfectivo(d) === anioVista);
    const noPerdidas = delAnioBase.filter(d => d.estado !== "Perdido");
    const sinMes = noPerdidas.filter(d => !MESES.includes(String(d.mes_radicacion || "").toLowerCase())).length;
    const sinProb = delAnioBase.filter(d => ESTADOS_ACTIVOS.has(d.estado) && !(parseFloat(d.prob) > 0)).length;
    if (!esAdmin() || sinMes + sinProb === 0) {
      salud.style.display = "none";
    } else {
      salud.style.display = "block";
      salud.innerHTML = `🩺 Calidad de datos ${anioVista}: <b>${sinMes}</b> oportunidades sin mes de radicación · <b>${sinProb}</b> activas sin probabilidad — clic para revisarlas`;
      salud.onclick = () => {
        ordenCampo = "mes_radicacion"; ordenDir = 1;
        renderTabla();
        mostrarSub("tabla");
        toast("Ordenado por radicación: las vacías quedan de primeras");
      };
    }
  }

  // Tarjetas
  $("dash-cards").innerHTML = `
    <div class="m-card"><div class="m-lbl">Cuota ${anioVista}</div>
      <div class="m-val">${hayCuotaAnio ? fmt(cuota) : "—"}</div>
      <div class="m-sub">${!hayCuotaAnio ? "sin cuota definida para " + anioVista : !esAdmin() ? "mi cuota" : (repsFiltrados.length === 1 ? "cuota de " + esc(repsFiltrados[0]) : repsFiltrados.length > 1 ? "cuota de " + repsFiltrados.length + " reps" : "equipo completo")}</div></div>
    <div class="m-card clic" id="dc-ganado"><div class="m-lbl">Ganado ${anioVista}</div>
      <div class="m-val" style="color:var(--green)">${fmt(vGanado)}</div>
      <div class="m-sub">${ganados.length} oportunidades · clic para ver</div></div>
    <div class="m-card clic" id="dc-activo"><div class="m-lbl">Pipeline activo</div>
      <div class="m-val" style="color:var(--blue)">${fmt(vActivo)}</div>
      <div class="m-sub">${activos.length} ops · esperado: ${fmt(vEsp)}</div></div>
    <div class="m-card"><div class="m-lbl">Forecast</div>
      <div class="m-val" style="color:${colorF}">${cuota > 0 ? fPct + "%" : "—"}</div>
      <div class="m-sub">(ganado + esperado) / cuota</div></div>
    <div class="m-card clic" id="dc-hold"><div class="m-lbl">On hold</div>
      <div class="m-val" style="color:#b45309">${fmt(vHold)}</div>
      <div class="m-sub">${enHold.length} ops · no suma al pipeline</div></div>
    <div class="m-card clic" id="dc-perdido"><div class="m-lbl">Perdido ${anioVista}</div>
      <div class="m-val" style="color:var(--red)">${fmt(vPerdido)}</div>
      <div class="m-sub">${perdidos.length} oportunidades · clic para ver</div></div>
  `;
  $("dc-ganado").addEventListener("click", () => irATablaFiltrada("Ganado"));
  $("dc-perdido").addEventListener("click", () => irATablaFiltrada("Perdido"));
  $("dc-hold").addEventListener("click", () => irATablaFiltrada("On hold"));
  $("dc-activo").addEventListener("click", () => irATablaFiltrada([...ESTADOS_ACTIVOS]));

  // Dona de forecast
  mkChart("ch-forecast", {
    type: "doughnut",
    data: { datasets: [{
      data: cuota > 0 ? [Math.min(fPct, 100), Math.max(100 - fPct, 0)] : [0, 100],
      backgroundColor: [colorF, "#f0efe9"],
      borderWidth: 0
    }]},
    options: {
      cutout: "72%", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, tooltip: { enabled: false },
        title: {
          display: true,
          text: cuota > 0
            ? [`${fPct}% del forecast`, `Ganado ${fmt(vGanado)} + Esp. ${fmt(vEsp)}`, `Cuota: ${fmt(cuota)}`]
            : [`Sin cuota definida para ${anioVista}`, `Ganado ${fmt(vGanado)} + Esp. ${fmt(vEsp)}`],
          font: { size: 12 }, color: "#1a1a18"
        }
      }
    }
  });

  // Embudo por estado (solo las 4 etapas activas) + On hold aparte, en gris
  const maxV = Math.max(...ORDEN_EMBUDO.map(e =>
    activos.filter(d => d.estado === e).reduce((s, d) => s + (parseFloat(d.valor) || 0), 0)), 1);
  const filaHold = enHold.length
    ? `<div class="funnel-row clic funnel-hold" data-estado="On hold" title="On hold no suma al pipeline activo">
        <span class="funnel-lbl">On hold</span>
        <div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(Math.min(Math.round(vHold / maxV * 100), 100), 8)}%">${fmt(vHold)}</div></div>
        <span class="funnel-n">${enHold.length} ops</span>
      </div>
      <p class="hint" style="margin:0 0 0 102px">Fuera del pipeline activo: no suma valor ni esperado.</p>`
    : "";
  $("dash-funnel").innerHTML = ORDEN_EMBUDO.map((e, i) => {
    const sub = activos.filter(d => d.estado === e);
    const v = sub.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
    const w = Math.round(v / maxV * 100);
    return `<div class="funnel-row clic" data-estado="${e}">
      <span class="funnel-lbl">${e}</span>
      <div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(w, 8)}%;background:${COLORES_EMBUDO[i]}">${fmt(v)}</div></div>
      <span class="funnel-n">${sub.length} ops</span>
    </div>`;
  }).join("") + filaHold;
  $("dash-funnel").querySelectorAll(".funnel-row").forEach(row => {
    row.addEventListener("click", () => irATablaFiltrada(row.dataset.estado));
  });

  // Pipeline por mes de radicación
  // Forecast de radicación mensual:
  //   Ganado → cuenta al 100% de su valor en su mes de radicación
  //   Activo → cuenta su valor esperado (valor × probabilidad)
  //   On hold / Perdido → no cuentan
  // La barra apilada de cada mes = lo que se proyecta radicar ese mes.
  const mesGan = {}, mesEsp = {};
  let sinMesGan = 0, sinMesEsp = 0;
  ganados.forEach(d => {
    const m = String(d.mes_radicacion || "").toLowerCase();
    if (MESES.includes(m)) mesGan[m] = (mesGan[m] || 0) + (parseFloat(d.valor) || 0);
    else sinMesGan += parseFloat(d.valor) || 0;
  });
  activos.forEach(d => {
    const m = String(d.mes_radicacion || "").toLowerCase();
    if (MESES.includes(m)) mesEsp[m] = (mesEsp[m] || 0) + esperadoDe(d);
    else sinMesEsp += esperadoDe(d);
  });
  const mesLabels = MESES.filter(m => mesGan[m] || mesEsp[m]);
  const haySinMes = (sinMesGan + sinMesEsp) > 0;
  const etiquetasMes = [...mesLabels.map(m => m.slice(0, 3).toUpperCase()), ...(haySinMes ? ["SIN MES"] : [])];
  const dataGan = [...mesLabels.map(m => mesGan[m] || 0), ...(haySinMes ? [sinMesGan] : [])];
  const dataEsp = [...mesLabels.map(m => mesEsp[m] || 0), ...(haySinMes ? [sinMesEsp] : [])];
  mkChart("ch-meses", {
    type: "bar",
    data: {
      labels: etiquetasMes,
      datasets: [
        { label: "Ganado (100%)", data: dataGan, backgroundColor: "#16a34a", borderRadius: 4 },
        { label: "Esperado del activo", data: dataEsp, backgroundColor: "#7c3aed", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const mes = mesLabels[elems[0].index];
        if (!mes) return; // barra "SIN MES": no hay valor de mes por el cual filtrar
        filtros.mes = new Set(filtros.mes.size === 1 && filtros.mes.has(mes) ? [] : [mes]);
        actualizarMultiselects();
        render();
        mostrarSub("tabla");
      },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: {
          label: c2 => c2.dataset.label + ": " + fmtFull(c2.raw),
          footer: (items) => {
            const total = items.reduce((s, it) => s + (it.raw || 0), 0);
            return "Forecast del mes: " + fmtFull(total);
          }
        } }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => fmt(v) } }
      }
    }
  });

  // ── Top 10 cuentas: pipeline completo de cada cuenta, apilado por estado ──
  const ctaMap = {};
  propios.forEach(d => {
    if (!TOP_ESTADOS.includes(d.estado)) return; // Perdido no entra
    if (!String(d.cuenta || "").trim()) return;
    const k = nombreOficial(d.cuenta);   // una sola barra aunque esté escrita distinto
    const m = ctaMap[k] = ctaMap[k] || { total: 0, activo: 0, hold: 0, n: 0, porEstado: {} };
    const v = parseFloat(d.valor) || 0;
    m.n++;
    // El ranking suma activo + ganado; On hold se muestra pero NO suma
    if (d.estado === "On hold") m.hold += v; else m.total += v;
    if (ESTADOS_ACTIVOS.has(d.estado)) m.activo += v;
    const pe = m.porEstado[d.estado] = m.porEstado[d.estado] || { v: 0, n: 0 };
    pe.v += v; pe.n++;
  });
  const top10 = Object.keys(ctaMap)
    .sort((a, b) => (ctaMap[b].total - ctaMap[a].total) || (ctaMap[b].hold - ctaMap[a].hold))
    .slice(0, 10);
  const vacioTop = $("top10-vacio");
  if (vacioTop) vacioTop.style.display = top10.length ? "none" : "block";
  if (top10.length) {
    const estadosPresentes = TOP_ESTADOS.filter(e => top10.some(c => ctaMap[c].porEstado[e]));
    mkChart("ch-top10", {
      type: "bar",
      data: {
        labels: top10.map(c => c.length > 24 ? c.slice(0, 23) + "…" : c),
        datasets: estadosPresentes.map(e => ({
          label: e === "On hold" ? "On hold (no suma)" : e,
          data: top10.map(c => ctaMap[c].porEstado[e]?.v || 0),
          backgroundColor: TOP_COLORES[e],
          borderRadius: 3,
          stack: "cuenta"
        }))
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        onClick: (evt, elems) => {
          if (!elems.length) return;
          filtros.cuenta = top10[elems[0].index];
          render();
          mostrarSub("tabla");
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
          tooltip: { callbacks: {
            title: (items) => items.length ? top10[items[0].dataIndex] : "",
            label: (c2) => {
              const est = estadosPresentes[c2.datasetIndex];
              const pe = ctaMap[top10[c2.dataIndex]].porEstado[est];
              return pe ? `${c2.dataset.label}: ${fmtFull(pe.v)} · ${pe.n} ops` : null;
            },
            footer: (items) => {
              if (!items.length) return "";
              const m = ctaMap[top10[items[0].dataIndex]];
              return `Total cuenta (activo + ganado): ${fmtFull(m.total)} · ${m.n} ops\nPipeline activo: ${fmtFull(m.activo)}` +
                (m.hold ? `\nOn hold (no suma): ${fmtFull(m.hold)}` : "");
            }
          }, filter: (it) => it.raw > 0 }
        },
        scales: {
          x: { stacked: true, ticks: { callback: v => fmt(v) } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
  } else if (charts["ch-top10"]) {
    charts["ch-top10"].destroy(); delete charts["ch-top10"];
  }

  // Avance de cuota por rep (Gerencia ve a todos; un vendedor su barra)
  let nombres;
  if (!hayCuotaAnio) nombres = [];
  else if (!esAdmin()) nombres = CUOTAS[u.nombreRep] ? [u.nombreRep] : [];
  else if (repsFiltrados.length) nombres = repsFiltrados.filter(n => CUOTAS[n] !== undefined);
  else nombres = Object.keys(CUOTAS);
  $("dash-cuotas").innerHTML = nombres.map(nombre => {
    const cuotaRep = CUOTAS[nombre];
    const cumplido = propios
      .filter(d => d.rep === nombre && d.estado === "Ganado")
      .reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
    const pct = cuotaRep > 0 ? Math.round(cumplido / cuotaRep * 100) : 0;
    const color = pct >= 100 ? "#16a34a" : pct >= 60 ? "#d97706" : "#2563EB";
    return `<div class="cuota-row ${esAdmin() ? "clic" : ""}" data-rep="${esc(nombre)}">
      <div class="cuota-hdr">
        <span class="cuota-nombre">${esc(nombre)}</span>
        <span class="cuota-nums">${fmt(cumplido)} / ${fmt(cuotaRep)} · <b style="color:${color}">${pct}%</b></span>
      </div>
      <div class="cuota-bar-bg"><div class="cuota-bar-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
    </div>`;
  }).join("") || `<div class="lista-vacia">${hayCuotaAnio ? "Sin cuota asignada" : "Sin cuota definida para " + anioVista + " (las cuotas actuales son de " + ANIO_CUOTA + ")"}</div>`;
  if (esAdmin()) {
    $("dash-cuotas").querySelectorAll(".cuota-row").forEach(row => {
      row.addEventListener("click", () => irATablaFiltrada("", row.dataset.rep));
    });
  }

  // ── Ganado vs Perdido por mes + Motivos de pérdida ──
  const gvp = {};
  delAnio.forEach(d => {
    if (d.estado !== "Ganado" && d.estado !== "Perdido") return;
    const m = String(d.mes_radicacion || "").toLowerCase();
    if (!MESES.includes(m)) return;
    gvp[m] = gvp[m] || { g: 0, p: 0 };
    gvp[m][d.estado === "Ganado" ? "g" : "p"] += parseFloat(d.valor) || 0;
  });
  const gvpLabels = MESES.filter(m => gvp[m]);
  mkChart("ch-gvp", {
    type: "bar",
    data: {
      labels: gvpLabels.map(m => m.slice(0, 3).toUpperCase()),
      datasets: [
        { label: "Ganado", data: gvpLabels.map(m => gvp[m].g), backgroundColor: "#16a34a", borderRadius: 4 },
        { label: "Perdido", data: gvpLabels.map(m => gvp[m].p), backgroundColor: "#dc2626", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        irATablaFiltrada(elems[0].datasetIndex === 0 ? "Ganado" : "Perdido");
      },
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c2 => c2.dataset.label + ": " + fmtFull(c2.raw) } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => fmt(v) } } }
    }
  });

  const motivos = {};
  perdidos.forEach(d => {
    const m = String(d.motivo_perdida || "").trim() || "Sin motivo";
    motivos[m] = (motivos[m] || 0) + 1;
  });
  const motLabels = Object.keys(motivos).sort((a, b) => motivos[b] - motivos[a]);
  const MOT_COLORS = ["#dc2626", "#d97706", "#7c3aed", "#2563EB", "#0d9488", "#6b7280", "#16a34a", "#9b9b96"];
  mkChart("ch-motivos", {
    type: "doughnut",
    data: {
      labels: motLabels,
      datasets: [{ data: motLabels.map(m => motivos[m]), backgroundColor: motLabels.map((_, i) => MOT_COLORS[i % MOT_COLORS.length]), borderWidth: 0 }]
    },
    options: {
      cutout: "60%", responsive: true, maintainAspectRatio: false,
      onClick: () => irATablaFiltrada("Perdido"),
      plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } } }
    }
  });

  // ── Retail vs Corporativo (campo canal), sobre el universo filtrado ──
  const PALETA_EXTRA = ["#7c3aed", "#0d9488", "#dc2626", "#16a34a", "#6b7280", "#b45309"];

  // Universo de las gráficas de composición (Segmento, Canal, Origen, Brokers):
  // pipeline activo + ganado. On hold y Perdido NO suman.
  const vigentes = propios.filter(d => d.estado !== "On hold" && d.estado !== "Perdido");

  // ── Segmento: Retail vs Corporativo (campo segmento, tolera que venga en canal) ──
  const bucketsSeg = {};
  vigentes.forEach(d => {
    const clave = segmentoDe(d) || "Sin segmento";
    const b = bucketsSeg[clave] = bucketsSeg[clave] || { n: 0, v: 0 };
    b.n++; b.v += parseFloat(d.valor) || 0;
  });
  const segLabels = Object.keys(bucketsSeg).sort((a, b) => bucketsSeg[b].v - bucketsSeg[a].v);
  const SEG_COLORS = { "Retail": "#d97706", "Corporativo": "#2563EB", "Público": "#dc2626", "Sin segmento": "#9b9b96" };
  mkChart("ch-seg", {
    type: "doughnut",
    data: {
      labels: segLabels,
      datasets: [{ data: segLabels.map(k => bucketsSeg[k].v),
        backgroundColor: segLabels.map((k, i) => SEG_COLORS[k] || PALETA_EXTRA[i % PALETA_EXTRA.length]), borderWidth: 0 }]
    },
    options: {
      cutout: "60%", responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const k = segLabels[elems[0].index];
        filtros.segmento = new Set([k]);
        actualizarMultiselects(); render(); mostrarSub("tabla");
      },
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c2) => `${c2.label}: ${fmtFull(c2.raw)} · ${bucketsSeg[c2.label].n} ops` } }
      }
    }
  });
  const sumSeg = $("sum-seg");
  if (sumSeg) sumSeg.innerHTML = segLabels.map(k =>
    `<b>${esc(k)}</b>: ${bucketsSeg[k].n} ops · ${fmt(bucketsSeg[k].v)}`).join(" &nbsp;·&nbsp; ");

  // ── Canal (Directo / Indirecto), valores tal como están en la base ──
  const bucketsCanal = {};
  vigentes.forEach(d => {
    const clave = canalDe(d) || "Sin canal";
    const b = bucketsCanal[clave] = bucketsCanal[clave] || { n: 0, v: 0 };
    b.n++; b.v += parseFloat(d.valor) || 0;
  });
  const canalLabels = Object.keys(bucketsCanal).sort((a, b) => bucketsCanal[b].v - bucketsCanal[a].v);
  const CANAL_COLORS = { "Directo": "#7c3aed", "Indirecto": "#0d9488", "Sin canal": "#9b9b96" };
  mkChart("ch-canal", {
    type: "doughnut",
    data: {
      labels: canalLabels,
      datasets: [{ data: canalLabels.map(k => bucketsCanal[k].v),
        backgroundColor: canalLabels.map((k, i) => CANAL_COLORS[k] || PALETA_EXTRA[i % PALETA_EXTRA.length]), borderWidth: 0 }]
    },
    options: {
      cutout: "60%", responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        const k = canalLabels[elems[0].index];
        filtros.canal = new Set([k]);
        actualizarMultiselects(); render(); mostrarSub("tabla");
      },
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c2) => `${c2.label}: ${fmtFull(c2.raw)} · ${bucketsCanal[c2.label].n} ops` } }
      }
    }
  });
  $("sum-canal").innerHTML = canalLabels.map(k =>
    `<b>${esc(k)}</b>: ${bucketsCanal[k].n} ops · ${fmt(bucketsCanal[k].v)}`).join(" &nbsp;·&nbsp; ");

  // ── Origen de llegada (CRM, Broker, Agenda Comercial...) ──
  // Clic en una porción o en la leyenda → filtra TODO el dashboard (toggle).
  const bucketsOrigen = {};
  vigentes.forEach(d => {
    const clave = origenDe(d) || "Sin origen";
    const b = bucketsOrigen[clave] = bucketsOrigen[clave] || { n: 0, v: 0 };
    b.n++; b.v += parseFloat(d.valor) || 0;
  });
  const origenLabels = Object.keys(bucketsOrigen).sort((a, b) => bucketsOrigen[b].v - bucketsOrigen[a].v);
  mkChart("ch-origen", {
    type: "doughnut",
    data: {
      labels: origenLabels,
      datasets: [{ data: origenLabels.map(k => bucketsOrigen[k].v),
        backgroundColor: origenLabels.map((k, i) => k === "Sin origen" ? "#9b9b96" : ["#2563EB", "#16a34a", "#7c3aed", "#d97706", "#dc2626", "#0d9488", "#b45309"][i % 7]), borderWidth: 0 }]
    },
    options: {
      cutout: "60%", responsive: true, maintainAspectRatio: false,
      onClick: (evt, elems) => {
        if (!elems.length) return;
        toggleOrigen(origenLabels[elems[0].index]);
      },
      onHover: (evt, elems) => {
        const t = evt.native && evt.native.target;
        if (t) t.style.cursor = elems.length ? "pointer" : "default";
      },
      plugins: {
        legend: {
          position: "right", labels: { boxWidth: 10, font: { size: 11 } },
          // Clic en la leyenda = filtrar el dashboard por ese origen
          onClick: (evt, item) => toggleOrigen(origenLabels[item.index]),
          onHover: (evt) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = "pointer"; },
          onLeave: (evt) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = "default"; }
        },
        tooltip: { callbacks: {
          label: (c2) => `${c2.label}: ${fmtFull(c2.raw)} · ${bucketsOrigen[c2.label].n} ops`,
          footer: () => "Clic para filtrar el dashboard por este origen"
        } }
      }
    }
  });
  $("sum-origen").innerHTML = origenLabels.map(k =>
    `<b>${esc(k)}</b>: ${bucketsOrigen[k].n} ops · ${fmt(bucketsOrigen[k].v)}`).join(" &nbsp;·&nbsp; ");

  // ── Top brokers por valor (con clic para ver sus oportunidades) ──
  const brokers = {};
  vigentes.forEach(d => {
    const nom = brokerNom(d);
    if (!nom) return;
    const x = brokers[nom] = brokers[nom] || { n: 0, v: 0 };
    x.n++; x.v += parseFloat(d.valor) || 0;
  });
  const brokerLabels = Object.keys(brokers).sort((a, b) => brokers[b].v - brokers[a].v).slice(0, 8);
  const hayBrokers = brokerLabels.length > 0;
  const vacioBk = $("brokers-vacio");
  if (vacioBk) vacioBk.style.display = hayBrokers ? "none" : "block";
  if (hayBrokers) {
    mkChart("ch-brokers", {
      type: "bar",
      data: {
        labels: brokerLabels.map(b => b.length > 18 ? b.slice(0, 17) + "…" : b),
        datasets: [{ data: brokerLabels.map(b => brokers[b].v), backgroundColor: "#0d9488", borderRadius: 4 }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        onClick: (evt, elems) => {
          if (!elems.length) return;
          const nombre = brokerLabels[elems[0].index];
          filtros.texto = nombre.toLowerCase();
          $("pl-f-texto").value = nombre;
          render(); mostrarSub("tabla");
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c2) => `${fmtFull(c2.raw)} · ${brokers[brokerLabels[c2.dataIndex]].n} ops` } }
        },
        scales: { x: { ticks: { callback: v => fmt(v) } }, y: { grid: { display: false } } }
      }
    });
  } else if (charts["ch-brokers"]) {
    charts["ch-brokers"].destroy(); delete charts["ch-brokers"];
  }
}

// ═══════════════════════════════════════════
// TABLA (sub-vista Oportunidades)
// ═══════════════════════════════════════════
// Universo filtrado: base según rol + todos los filtros globales.
// Lo usan TANTO el Dashboard como la tabla de Oportunidades.
function filtrarDeals() {
  return baseDeals().filter(d => {
    // Año: cada pantalla muestra ÚNICAMENTE el año seleccionado (2026, 2027 o 2028)
    if (anioEfectivo(d) !== anioVista) return false;
    if (filtros.rep.size && !filtros.rep.has(d.rep)) return false;
    if (filtros.estado.size && !filtros.estado.has(d.estado)) return false;
    if (filtros.tipo.size && !filtros.tipo.has(tipoDe(d) || "Sin tipo")) return false;
    if (filtros.canal.size && !filtros.canal.has(canalDe(d) || "Sin canal")) return false;
    if (filtros.segmento.size && !filtros.segmento.has(segmentoDe(d) || "Sin segmento")) return false;
    if (filtros.origen.size && !filtros.origen.has(origenDe(d) || "Sin origen")) return false;
    if (filtros.riesgo.size && !filtros.riesgo.has(String(d.riesgo || "").trim())) return false;
    if (filtros.mes.size && !filtros.mes.has(d.mes_radicacion)) return false;
    if (filtros.cuenta && claveCuenta(d.cuenta) !== claveCuenta(filtros.cuenta)) return false;
    if (filtros.texto) {
      const blob = ((d.oportunidad || "") + " " + (d.cuenta || "") + " " + nombreOficial(d.cuenta) + " " + brokerNom(d)).toLowerCase();
      if (!blob.includes(filtros.texto)) return false;
    }
    return true;
  });
}

function renderTabla() {
  const todasVisibles = filtrarDeals();
  // Por defecto las Perdidas NO se listan (ya no son pipeline). Se ven
  // marcando "Perdido" en el filtro Estado o desde la tarjeta "Perdido".
  const visibles = filtros.estado.size ? todasVisibles : todasVisibles.filter(d => d.estado !== "Perdido");
  const noteEl = $("pl-scope-note");
  if (noteEl) noteEl.textContent = notaAlcance();

  const activos = visibles.filter(d => ESTADOS_ACTIVOS.has(d.estado));
  const ganados = visibles.filter(d => d.estado === "Ganado");
  const valorActivo = activos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const valorGanado = ganados.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const espActivo = activos.reduce((s, d) => s + esperadoDe(d), 0);
  $("pl-metricas").innerHTML = `
    <div class="m-card"><div class="m-lbl">Pipeline activo</div>
      <div class="m-val" style="color:var(--blue)">${fmt(valorActivo)}</div>
      <div class="m-sub">${activos.length} oportunidades (sin On hold)</div></div>
    <div class="m-card"><div class="m-lbl">Valor esperado</div>
      <div class="m-val" style="color:var(--purple)">${fmt(espActivo)}</div>
      <div class="m-sub">valor × probabilidad</div></div>
    <div class="m-card"><div class="m-lbl">Ganado</div>
      <div class="m-val" style="color:var(--green)">${fmt(valorGanado)}</div>
      <div class="m-sub">${ganados.length} oportunidades</div></div>
    <div class="m-card"><div class="m-lbl">Registros</div>
      <div class="m-val">${visibles.length}</div>
      <div class="m-sub">de ${baseDeals().length} en la base</div></div>
  `;

  const orden = [...visibles].sort((a, b) => {
    let va = a[ordenCampo], vb = b[ordenCampo];
    if (ordenCampo === "esperado") { va = esperadoDe(a); vb = esperadoDe(b); }
    if (["valor", "esperado", "prob"].includes(ordenCampo)) {
      va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
      return (va - vb) * ordenDir;
    }
    return String(va || "").localeCompare(String(vb || ""), "es") * ordenDir;
  });

  $("pl-tabla").querySelectorAll("th[data-orden]").forEach(th => {
    const ico = th.querySelector(".sort-ico");
    ico.textContent = th.dataset.orden === ordenCampo ? (ordenDir === -1 ? "↓" : "↑") : "↕";
    ico.style.opacity = th.dataset.orden === ordenCampo ? "1" : ".35";
  });

  $("pl-conteo").textContent = `${visibles.length} resultado(s)`;

  $("pl-tbody").innerHTML = orden.length === 0
    ? `<tr><td colspan="10" class="lista-vacia">Sin resultados con los filtros actuales</td></tr>`
    : orden.map(d => {
      const v = parseFloat(d.valor) || 0;
      const esp = esperadoDe(d);
      const p = probDe(d);
      return `
      <tr>
        <td>${esc(d.oportunidad)}</td>
        <td>${esc(d.cuenta)}</td>
        <td>${esc(d.rep)}</td>
        <td>${badge(d.estado)}</td>
        <td style="text-align:right" title="${fmtFull(v)}">${fmt(v)}</td>
        <td style="text-align:right" title="${fmtFull(esp)}">${fmt(esp)}</td>
        <td style="text-align:right">${Math.round(p * 100)}%</td>
        <td>${rBadge(d.riesgo)}</td>
        <td>${esc(d.mes_radicacion) || "—"} · ${anioEfectivo(d)}</td>
        <td style="text-align:right">${puedeEditar(d)
          ? `<button class="btn-editar" data-id="${d.id}" title="Editar oportunidad" aria-label="Editar oportunidad">✏️</button>` : ""}</td>
      </tr>`;
    }).join("");

  $("pl-tbody").querySelectorAll(".btn-editar").forEach(btn => {
    btn.addEventListener("click", () => {
      const deal = deals.find(x => x.id === btn.dataset.id);
      if (deal) abrirModal(deal);
    });
  });
}

// Nota de alcance mostrada en "Oportunidades"
function notaAlcance() {
  const partes = [`año de radicación ${anioVista}`];
  if (!filtros.estado.size) partes.push("sin Perdidas");
  return `Mostrando: ${partes.join(" · ")}. Cambia el año arriba a la derecha o ajusta los filtros para ver más.`;
}

// ═══════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════
// Aviso en el formulario: qué pasa con el valor al marcar Ganado / Perdido / On hold.
// Ganado deja la probabilidad fija en 100% (el campo se bloquea).
function actualizarHintEstado() {
  const est = $("pl-c-estado").value;
  const el = $("pl-hint-estado");
  const probEl = $("pl-c-prob");
  if (probEl) {
    if (est === "Ganado") {
      probEl.value = 100;
      probEl.disabled = true;
    } else {
      probEl.disabled = false;
    }
  }
  if (!el) return;
  if (est === "Ganado") {
    el.textContent = "Ganada: la probabilidad queda en 100% y el valor esperado es el 100% del valor.";
    el.style.color = "#15803d";
    el.style.display = "block";
    return;
  }
  el.style.color = "";
  if (est === "Perdido") {
    el.textContent = "Al guardar como Perdida sale del pipeline activo y su valor esperado queda en $0.";
    el.style.display = "block";
  } else if (est === "On hold") {
    el.textContent = "On hold no suma al pipeline activo ni al valor esperado.";
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

// Selector cerrado con opción temporal "(valor anterior)" para no perder
// datos viejos que no encajan en la lista (ej. tipo "Proyecto" o año 2025).
function setSelectConLegado(sel, valor) {
  sel.querySelectorAll("option[data-legado]").forEach(o => o.remove());
  const v = String(valor ?? "").trim();
  if (v && ![...sel.options].some(o => o.value === v)) {
    const op = document.createElement("option");
    op.value = v; op.textContent = v + " (valor anterior)"; op.dataset.legado = "1";
    sel.appendChild(op);
  }
  sel.value = v;
}

function abrirModal(deal) {
  editandoId = deal ? deal.id : null;
  $("pl-modal-titulo").textContent = deal ? "Editar oportunidad" : "Nueva oportunidad";
  $("pl-modal-error").textContent = "";
  $("pl-c-oportunidad").value = deal?.oportunidad || "";
  cuentaNueva = null; brokerNuevo = null; confirmarParecida = false; confirmarBrokerParecido = false;
  $("pl-cta-crear").style.display = "none";
  $("pl-brk-crear").style.display = "none";
  $("pl-c-cuenta").value = deal ? nombreOficial(deal.cuenta) : "";
  if (esAdmin()) $("pl-c-rep").value = deal?.rep || "";
  $("pl-c-estado").value = deal?.estado || "";
  $("pl-c-valor").value = deal?.valor ?? "";
  const prob = parseFloat(deal?.prob);
  $("pl-c-prob").value = isNaN(prob) ? "" : Math.round(prob * 100);
  // Listas cerradas: los valores viejos se traducen; si no se puede, quedan vacíos y se piden
  $("pl-c-tipo").value = deal ? tipoDe(deal) : "";
  $("pl-c-segmento").value = deal ? (normSegmento(deal.segmento) || normSegmento(deal.canal)) : "";
  $("pl-c-canal").value = deal ? canalDe(deal) : "";
  poblarOrigen("pl-c-origen", $("pl-c-canal").value, deal ? origenDe(deal) : "");
  $("pl-brk-wrap").style.display = $("pl-c-canal").value === "Indirecto" ? "block" : "none";
  poblarBrokersSelect("pl-c-broker", "");
  $("pl-brk-res").innerHTML = "";
  const brkViejo = String(deal?.broker || "").trim();
  if (brkViejo) {
    const b = brokerDe(brkViejo);
    if (b) $("pl-c-broker").value = b.nombre;
    else $("pl-brk-res").innerHTML = `<span class="warn">⚠ El broker “${esc(brkViejo)}” de este registro no está creado.</span><button type="button" id="pl-brk-crear-viejo">＋ Crearlo</button>`;
    const bv = $("pl-brk-crear-viejo");
    if (bv) bv.addEventListener("click", () => abrirCrearBroker(brkViejo));
  }
  alCambiarCuentaPl();
  $("pl-c-riesgo").value = deal?.riesgo || "";
  $("pl-c-mes-inicio").value = deal?.mes_inicio || "";
  $("pl-c-mes").value = deal?.mes_radicacion || "";
  // Nueva oportunidad → por defecto el año que se está viendo en pantalla
  setSelectConLegado($("pl-c-anio"), deal ? String(anioEfectivo(deal)) : String(anioVista));
  $("pl-c-motivo").value = deal?.motivo_perdida || "";
  $("pl-c-comentarios").value = deal?.comentarios || "";
  $("pl-btn-eliminar").style.display = (deal && esAdmin()) ? "inline-block" : "none";
  actualizarHintEstado();
  $("pl-modal").classList.add("open");
}

function cerrarModal() {
  $("pl-modal").classList.remove("open");
  editandoId = null;
}

async function guardar() {
  const err = $("pl-modal-error");
  err.textContent = "";
  const u = obtenerUsuario();

  const oportunidad = $("pl-c-oportunidad").value.trim();
  const ctaSel = cuentaElegida();
  const rep = esAdmin() ? $("pl-c-rep").value : u.nombreRep;
  const estado = $("pl-c-estado").value;
  const valor = parseFloat($("pl-c-valor").value);

  if (!oportunidad || !$("pl-c-cuenta").value.trim() || !rep || !estado || isNaN(valor)) {
    err.textContent = "Completa los campos obligatorios (*).";
    return;
  }
  if (!ctaSel) {
    err.textContent = "La cuenta debe existir en la base: elígela de la lista o usa “＋ Crear cuenta”.";
    return;
  }
  const cuenta = ctaSel.nombre;
  const tipo = $("pl-c-tipo").value;
  const segmento = ctaSel.segmento || $("pl-c-segmento").value;
  const canal = $("pl-c-canal").value;
  const origen = canal === "Indirecto" ? ORIGEN_INDIRECTO : $("pl-c-origen").value;
  if (!tipo || !segmento || !canal || !origen) {
    err.textContent = "Completa Tipo, Segmento, Canal y Origen.";
    return;
  }
  let broker = "", brokerId = "";
  if (canal === "Indirecto") {
    const bn = $("pl-c-broker").value;
    const b = brokerDe(bn) || (brokerNuevo && claveCuenta(brokerNuevo.nombre) === claveCuenta(bn) ? brokerNuevo : null);
    if (!b) { err.textContent = "Elige el broker de la lista (o créalo con “＋ Crear broker”)."; return; }
    broker = b.nombre; brokerId = claveCuenta(b.nombre);
  }
  // La ficha de la cuenta guarda el segmento (así Agenda y Sprint lo ven igual)
  if (!ctaSel.fichaId) {
    const rf = await crearCuenta(ctaSel.clave, { nombre: cuenta, segmento, contactos: [], creadoPor: u?.nombreRep || "Gerencia", origen: "Pipeline" });
    if (!rf.ok) console.warn("No se creó la ficha de la cuenta:", rf.error);
  } else if (!normSegmento(ctaSel.ficha?.segmento)) {
    const rf = await actualizarCuenta(ctaSel.fichaId, { segmento });
    if (!rf.ok) console.warn("No se actualizó el segmento de la cuenta:", rf.error);
  }

  const probPct = parseFloat($("pl-c-prob").value);
  const probIngresada = isNaN(probPct) ? 0 : Math.min(Math.max(probPct, 0), 100) / 100;
  // Ganada → 100% del valor · Perdida → 0 · resto → valor × probabilidad
  const { prob, esperado } = probYEsperado(estado, valor, probIngresada);
  const anioSel = parseInt($("pl-c-anio").value);
  const datos = {
    oportunidad, cuenta, cuentaId: ctaSel.clave, rep, estado,
    valor,
    prob,
    esperado,
    tipo, canal, origen, segmento, broker, brokerId,
    riesgo: $("pl-c-riesgo").value,
    mes_inicio: $("pl-c-mes-inicio").value,
    mes_radicacion: $("pl-c-mes").value,
    anio_radicacion: isNaN(anioSel) ? anioVista : anioSel,
    motivo_perdida: $("pl-c-motivo").value,
    comentarios: $("pl-c-comentarios").value.trim()
  };

  const btn = $("pl-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  const eraEdicion = !!editandoId;
  const res = eraEdicion ? await actualizarDeal(editandoId, datos) : await crearDeal(datos);
  btn.disabled = false; btn.textContent = "💾 Guardar";

  if (res.ok) {
    cerrarModal();
    toast(estado === "Perdido"
      ? "✓ Marcada como Perdida — salió del pipeline activo"
      : estado === "Ganado"
      ? "✓ Marcada como Ganada — valor esperado al 100%"
      : (eraEdicion ? "✓ Oportunidad actualizada" : "✓ Oportunidad creada"));
  }
  else err.textContent = res.error;
}

async function eliminar() {
  if (!editandoId) return;
  if (!confirm("¿Eliminar esta oportunidad? Esta acción no se puede deshacer.")) return;
  const res = await eliminarDeal(editandoId);
  if (res.ok) { cerrarModal(); toast("🗑 Oportunidad eliminada"); }
  else $("pl-modal-error").textContent = res.error;
}

// ═══════════════════════════════════════════
// ⚙️ MODAL DE CUOTAS (solo Gerencia)
// ═══════════════════════════════════════════
function ctFila(nombre, valor) {
  return `<div class="ct-fila" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
    <input class="form-input ct-nombre" style="flex:1;min-width:0" placeholder="Nombre del rep" value="${esc(nombre)}"/>
    <input class="form-input ct-valor" style="width:160px" type="number" min="0" step="1000000" placeholder="Cuota (COP)" value="${valor ?? ""}"/>
    <button class="btn-editar ct-quitar" type="button" title="Quitar rep" aria-label="Quitar rep">✕</button>
  </div>`;
}

function abrirModalCuotas() {
  $("ct-error").textContent = "";
  $("ct-anio").value = ANIO_CUOTA;
  const nombres = Object.keys(CUOTAS).sort((a, b) => a.localeCompare(b, "es"));
  $("ct-filas").innerHTML = nombres.map(n => ctFila(n, CUOTAS[n])).join("");
  $("ct-modal").classList.add("open");
}

async function guardarCuotasUI() {
  const err = $("ct-error");
  err.textContent = "";

  const anio = parseInt($("ct-anio").value);
  if (isNaN(anio) || anio < 2020 || anio > 2100) {
    err.textContent = "Indica un año de cuota válido (ej: 2026).";
    return;
  }

  const valores = {};
  let problema = "";
  $("ct-filas").querySelectorAll(".ct-fila").forEach(fila => {
    const nombre = fila.querySelector(".ct-nombre").value.trim();
    const cuota = parseFloat(fila.querySelector(".ct-valor").value);
    if (!nombre) return; // filas vacías se ignoran
    if (valores[nombre] !== undefined) problema = `El rep "${nombre}" está repetido.`;
    if (isNaN(cuota) || cuota < 0) problema = `La cuota de "${nombre}" no es válida.`;
    valores[nombre] = Math.round(cuota);
  });
  if (problema) { err.textContent = problema; return; }
  if (Object.keys(valores).length === 0) {
    err.textContent = "Agrega al menos un rep con su cuota.";
    return;
  }

  const btn = $("ct-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  const res = await guardarCuotas(anio, valores);
  btn.disabled = false; btn.textContent = "💾 Guardar cuotas";

  if (res.ok) {
    $("ct-modal").classList.remove("open");
    toast("✓ Cuotas actualizadas — el dashboard ya las refleja");
  } else {
    err.textContent = res.error;
  }
}

// ═══════════════════════════════════════════
// 🏢 VISTA DE CUENTAS (consolidado por cliente)
// ═══════════════════════════════════════════
function renderCuentas() {
  const cont = $("ctas-tbody");
  if (!cont) return;
  const visibles = filtrarDeals();

  const mapa = {};
  visibles.forEach(d => {
    const raw = String(d.cuenta || "").trim();
    const k = raw ? claveCuenta(raw) : "(sin cuenta)";
    const m = mapa[k] = mapa[k] || { nombre: raw ? nombreOficial(raw) : "(Sin cuenta)", n: 0, total: 0, activo: 0, esperado: 0, ganado: 0, segmento: raw ? (cuentaDe(raw)?.segmento || "") : "" };
    const v = parseFloat(d.valor) || 0;
    m.n++;
    // Valor total = activo + ganado (On hold y Perdidas no suman)
    if (d.estado !== "Perdido" && d.estado !== "On hold") m.total += v;
    if (ESTADOS_ACTIVOS.has(d.estado)) { m.activo += v; m.esperado += esperadoDe(d); }
    if (d.estado === "Ganado") m.ganado += v;
  });
  const lista = Object.values(mapa).sort((a, b) => b.total - a.total);
  const multi = lista.filter(x => x.n > 1);

  $("ctas-metricas").innerHTML = `
    <div class="m-card"><div class="m-lbl">Cuentas</div>
      <div class="m-val">${lista.length}</div>
      <div class="m-sub">con los filtros actuales</div></div>
    <div class="m-card"><div class="m-lbl">Con varias oportunidades</div>
      <div class="m-val" style="color:var(--blue)">${multi.length}</div>
      <div class="m-sub">2 o más oportunidades</div></div>
    <div class="m-card"><div class="m-lbl">Valor total</div>
      <div class="m-val" style="color:var(--purple)">${fmt(lista.reduce((s, x) => s + x.total, 0))}</div>
      <div class="m-sub">suma de todas las cuentas</div></div>
  `;

  cont.innerHTML = lista.length === 0
    ? `<tr><td colspan="7" class="lista-vacia">Sin cuentas con los filtros actuales</td></tr>`
    : lista.map(x => `
      <tr class="cta-row" data-cta="${esc(x.nombre)}" style="cursor:pointer">
        <td><b>${esc(x.nombre)}</b>${x.segmento ? ` <span class="badge" style="background:#F3F4F6;color:#374151">${esc(SEGMENTO_TXT[x.segmento])}</span>` : ""}</td>
        <td style="text-align:right">${x.n}</td>
        <td style="text-align:right" title="${fmtFull(x.total)}"><b>${fmt(x.total)}</b></td>
        <td style="text-align:right">${fmt(x.activo)}</td>
        <td style="text-align:right">${fmt(x.esperado)}</td>
        <td style="text-align:right;color:var(--green)">${fmt(x.ganado)}</td>
        <td style="text-align:right">${ultimoContactoHtml(x.nombre)}</td>
      </tr>`).join("");

  cont.querySelectorAll(".cta-row").forEach(tr => {
    tr.addEventListener("click", () => {
      const nombre = tr.dataset.cta;
      if (nombre === "(Sin cuenta)") return;
      abrirFicha(nombre);
    });
  });
}

// "hace 12 d" con color: verde < 30 días, ámbar < 90, rojo ≥ 90
function ultimoContactoHtml(nombre) {
  const a = actividadCuenta(nombre);
  if (a.dias == null) return `<span style="color:var(--txt3)">—</span>`;
  const color = a.dias < 30 ? "#15803d" : a.dias < 90 ? "#b45309" : "#b91c1c";
  return `<span style="color:${color};font-weight:600" title="${a.gestiones} gestión(es) · última ${a.ultima}">${a.dias === 0 ? "hoy" : "hace " + a.dias + " d"}</span>`;
}

// 📇 Abre la ficha 360 de la cuenta
function abrirFicha(nombre) {
  abrirFichaCuenta(nombre, {
    onVerOportunidades: (n) => {
      filtros.cuenta = n; // filtro exacto
      render();
      mostrarSub("tabla");
    },
    onAbrirDeal: (d) => {
      if (puedeEditar(d)) abrirModal(d);
      else toast(`Solo lectura: esta oportunidad es de ${d.rep || "otro rep"}`);
    }
  });
}

function llenarBuscadorCuentas() {
  const dl = $("ctas-dl");
  if (dl) dl.innerHTML = listaCuentas().map(c => `<option value="${esc(c.nombre)}">`).join("");
}
function abrirDesdeBuscador() {
  const inp = $("ctas-buscar");
  const txt = inp.value.trim();
  if (!txt) return;
  const k = txt.toLowerCase();
  const nombres = listaCuentas().map(c => c.nombre);
  const exacta = cuentaDe(txt);
  const exacto = exacta?.nombre || nombres.find(n => n.toLowerCase() === k);
  const parecido = exacto || nombres.find(n => n.toLowerCase().includes(k));
  if (!parecido) { toast("No encontramos esa cuenta"); return; }
  inp.value = "";
  abrirFicha(parecido);
}

// ═══════════════════════════════════════════
// 🏢 CUENTA Y 🤝 BROKER EN EL FORMULARIO (listas cerradas)
// ═══════════════════════════════════════════
function llenarListasForm() {
  const dl = $("pl-dl-cuenta");
  if (dl) dl.innerHTML = listaCuentas().map(c => `<option value="${esc(c.nombre)}">`).join("");
  poblarBrokersSelect("pl-c-broker", $("pl-c-broker")?.value);
  poblarBrokersSelect("ml-broker", $("ml-broker")?.value);
}
function poblarBrokersSelect(id, actual) {
  const sel = $(id);
  if (!sel) return;
  const lista = listaBrokers();
  if (brokerNuevo && !lista.some(b => claveCuenta(b.nombre) === claveCuenta(brokerNuevo.nombre))) lista.push(brokerNuevo);
  sel.innerHTML = `<option value="">${lista.length ? "— Selecciona el broker —" : "— Aún no hay brokers: créalo —"}</option>` +
    lista.map(b => `<option value="${esc(b.nombre)}">${esc(b.nombre)}${b.empresa ? " · " + esc(b.empresa) : ""}</option>`).join("");
  if (actual && lista.some(b => b.nombre === actual)) sel.value = actual;
}
// Origen depende del canal: Directo → Referido/Rep/Gerencia/CRM · Indirecto → Broker
function poblarOrigen(selId, canal, actual) {
  const sel = $(selId);
  if (!sel) return;
  if (canal === "Indirecto") {
    sel.innerHTML = `<option value="${ORIGEN_INDIRECTO}">🤝 ${ORIGEN_INDIRECTO}</option>`;
    sel.value = ORIGEN_INDIRECTO; sel.disabled = true;
  } else if (canal === "Directo") {
    sel.disabled = false;
    sel.innerHTML = `<option value="">— Selecciona —</option>` + ORIGENES_DIRECTO.map(o => `<option>${o}</option>`).join("");
    sel.value = ORIGENES_DIRECTO.includes(actual) ? actual : "";
  } else {
    sel.disabled = true;
    sel.innerHTML = `<option value="">Elige primero el canal</option>`;
  }
}
function alCambiarCanal() {
  const canal = $("pl-c-canal").value;
  poblarOrigen("pl-c-origen", canal, $("pl-c-origen").value);
  $("pl-brk-wrap").style.display = canal === "Indirecto" ? "block" : "none";
  if (canal !== "Indirecto") $("pl-brk-crear").style.display = "none";
}

// Cuenta elegida en el formulario (de la base o recién creada) o null
function cuentaElegida() {
  const v = $("pl-c-cuenta").value.trim();
  if (!v) return null;
  const c = cuentaDe(v);
  if (c) return c;
  if (cuentaNueva && cuentaNueva.clave === claveCuenta(v)) return cuentaNueva;
  return null;
}
function sugerenciasCuenta(texto, n) {
  if (String(texto).trim().length < 3) return [];
  return listaCuentas()
    .map(c => ({ c, p: parecidoCuentas(texto, c.nombre) }))
    .filter(x => x.p >= 0.5)
    .sort((a, b) => b.p - a.p).slice(0, n).map(x => x.c);
}
function alCambiarCuentaPl() {
  const v = $("pl-c-cuenta").value.trim();
  const res = $("pl-cta-res");
  const seg = $("pl-c-segmento");
  const c = cuentaElegida();
  const nota = $("pl-seg-nota");
  if (!v) {
    res.innerHTML = `<span class="mut">Elige la cuenta de la lista. ¿Cliente nuevo?</span><button type="button" data-nc>＋ Crear cuenta</button>`;
    seg.disabled = false; nota.textContent = "";
  } else if (c) {
    res.innerHTML = `<span class="ok">✓ ${esc(c.nombre)}</span>` +
      (c.segmento ? badge(SEGMENTO_TXT[c.segmento], { bg: "#F3F4F6", cl: "#374151" }) : `<span class="warn">sin segmento: elígelo abajo</span>`) +
      (v !== c.nombre ? `<span class="mut">se guardará como “${esc(c.nombre)}”</span>` : "");
    if (c.segmento) { seg.value = c.segmento; seg.disabled = true; nota.textContent = "Viene de la cuenta"; }
    else { seg.disabled = false; nota.textContent = "Quedará guardado en la cuenta"; }
  } else {
    const sug = sugerenciasCuenta(v, 3);
    res.innerHTML = `<span class="warn">⚠ “${esc(v)}” no está en la base.</span>` +
      sug.map(x => `<button type="button" data-usar="${esc(x.nombre)}">¿${esc(x.nombre)}?</button>`).join("") +
      `<button type="button" data-nc>＋ Crear cuenta</button>`;
    seg.disabled = false; nota.textContent = "";
  }
  res.querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", () => { $("pl-c-cuenta").value = b.dataset.usar; alCambiarCuentaPl(); }));
  res.querySelectorAll("[data-nc]").forEach(b => b.addEventListener("click", abrirCrearCuenta));
}

function abrirCrearCuenta() {
  $("pl-cta-crear").style.display = "block";
  $("pl-nc-nombre").value = $("pl-c-cuenta").value.trim();
  $("pl-nc-seg").value = "";
  confirmarParecida = false;
  avisoCuentaNueva();
  $("pl-nc-nombre").focus();
}
// Avisa si la cuenta nueva ya existe o se parece a otra
function avisoCuentaNueva() {
  const n = $("pl-nc-nombre").value.trim();
  const av = $("pl-nc-aviso");
  const btn = $("pl-nc-ok");
  btn.textContent = "Crear cuenta";
  if (n.length < 2) { av.innerHTML = ""; return { bloqueo: true }; }
  const exacta = cuentaDe(n);
  if (exacta) {
    av.innerHTML = `<span class="warn">⚠ Ya existe como “${esc(exacta.nombre)}” (mayúsculas, puntos o SAS/SA no cuentan).</span><button type="button" id="pl-nc-usar">Usar esa cuenta</button>`;
    $("pl-nc-usar").addEventListener("click", () => { $("pl-c-cuenta").value = exacta.nombre; $("pl-cta-crear").style.display = "none"; alCambiarCuentaPl(); });
    return { bloqueo: true };
  }
  const sug = sugerenciasCuenta(n, 3);
  if (sug.length) {
    av.innerHTML = `<span class="warn">¿Es alguna de estas?</span>` + sug.map(x => `<button type="button" data-usar="${esc(x.nombre)}">${esc(x.nombre)}</button>`).join("");
    av.querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", () => { $("pl-c-cuenta").value = b.dataset.usar; $("pl-cta-crear").style.display = "none"; alCambiarCuentaPl(); }));
    if (!confirmarParecida) btn.textContent = "No, es otra: crear";
    return { parecidas: true };
  }
  av.innerHTML = `<span class="ok">✓ Nombre disponible</span>`;
  return {};
}
async function crearCuentaDesdeForm() {
  const nombre = $("pl-nc-nombre").value.trim().replace(/\s+/g, " ");
  const segmento = $("pl-nc-seg").value;
  const chk = avisoCuentaNueva();
  if (nombre.length < 2) { $("pl-nc-aviso").innerHTML = `<span class="warn">Escribe el nombre de la cuenta.</span>`; return; }
  if (chk.bloqueo) return;
  if (!segmento) { $("pl-nc-aviso").innerHTML = `<span class="warn">Elige el segmento.</span>`; return; }
  if (chk.parecidas && !confirmarParecida) { confirmarParecida = true; $("pl-nc-ok").textContent = "Confirmar: crear cuenta nueva"; return; }
  const u = obtenerUsuario();
  const clave = claveCuenta(nombre);
  const btn = $("pl-nc-ok");
  btn.disabled = true;
  const res = await crearCuenta(clave, { nombre, segmento, contactos: [], creadoPor: u?.nombreRep || "Gerencia", origen: "Pipeline · cuenta nueva" });
  btn.disabled = false;
  if (!res.ok) { $("pl-nc-aviso").innerHTML = `<span class="warn">${esc(res.error)}</span>`; return; }
  cuentaNueva = { clave, nombre, segmento, fichaId: clave, ficha: { segmento } };
  $("pl-c-cuenta").value = nombre;
  $("pl-cta-crear").style.display = "none";
  alCambiarCuentaPl();
  toast(`✓ Cuenta “${nombre}” creada`);
}

function abrirCrearBroker(nombre) {
  $("pl-brk-crear").style.display = "block";
  ["pl-nb-nombre", "pl-nb-empresa", "pl-nb-contacto", "pl-nb-correo", "pl-nb-tel", "pl-nb-notas"].forEach(id => $(id).value = "");
  $("pl-nb-nombre").value = nombre || "";
  confirmarBrokerParecido = false;
  avisoBrokerNuevo();
  $("pl-nb-nombre").focus();
}
function avisoBrokerNuevo() {
  const n = $("pl-nb-nombre").value.trim();
  const av = $("pl-nb-aviso");
  $("pl-nb-ok").textContent = "Crear broker";
  if (n.length < 2) { av.innerHTML = ""; return { bloqueo: true }; }
  const ex = brokerDe(n);
  if (ex) {
    av.innerHTML = `<span class="warn">⚠ Ya existe el broker “${esc(ex.nombre)}”.</span><button type="button" id="pl-nb-usar">Usarlo</button>`;
    $("pl-nb-usar").addEventListener("click", () => { $("pl-c-broker").value = ex.nombre; $("pl-brk-crear").style.display = "none"; $("pl-brk-res").innerHTML = ""; });
    return { bloqueo: true };
  }
  const sug = listaBrokers().filter(b => parecidoCuentas(n, b.nombre) >= 0.5).slice(0, 3);
  if (sug.length) {
    av.innerHTML = `<span class="warn">¿Es alguno de estos?</span>` + sug.map(b => `<button type="button" data-usar="${esc(b.nombre)}">${esc(b.nombre)}</button>`).join("");
    av.querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", () => { $("pl-c-broker").value = b.dataset.usar; $("pl-brk-crear").style.display = "none"; $("pl-brk-res").innerHTML = ""; }));
    if (!confirmarBrokerParecido) $("pl-nb-ok").textContent = "No, es otro: crear";
    return { parecidos: true };
  }
  av.innerHTML = `<span class="ok">✓ Nombre disponible</span>`;
  return {};
}
async function crearBrokerDesdeForm() {
  const nombre = $("pl-nb-nombre").value.trim().replace(/\s+/g, " ");
  const correo = $("pl-nb-correo").value.trim();
  const chk = avisoBrokerNuevo();
  if (nombre.length < 2) { $("pl-nb-aviso").innerHTML = `<span class="warn">Escribe el nombre del broker.</span>`; return; }
  if (chk.bloqueo) return;
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { $("pl-nb-aviso").innerHTML = `<span class="warn">El correo no es válido.</span>`; return; }
  if (chk.parecidos && !confirmarBrokerParecido) { confirmarBrokerParecido = true; $("pl-nb-ok").textContent = "Confirmar: crear broker nuevo"; return; }
  const u = obtenerUsuario();
  const datos = {
    nombre, empresa: $("pl-nb-empresa").value.trim(), contacto: $("pl-nb-contacto").value.trim(),
    correo, telefono: $("pl-nb-tel").value.trim(), notas: $("pl-nb-notas").value.trim(),
    creadoPor: u?.nombreRep || "Gerencia"
  };
  const btn = $("pl-nb-ok");
  btn.disabled = true;
  const res = await crearBroker(datos);
  btn.disabled = false;
  if (!res.ok) { $("pl-nb-aviso").innerHTML = `<span class="warn">${esc(res.error)}</span>`; return; }
  brokerNuevo = datos;
  poblarBrokersSelect("pl-c-broker", nombre);
  $("pl-c-broker").value = nombre;
  $("pl-brk-crear").style.display = "none";
  $("pl-brk-res").innerHTML = "";
  toast(`✓ Broker “${nombre}” creado`);
}

// 🤝 Sub-pestaña Brokers
function renderBrokers() {
  const cont = $("pl-sub-brk");
  if (!cont || cont.style.display === "none") return;
  pintarBrokers(cont, {
    deals: filtrarDeals(),
    todos: baseDeals(),
    anio: anioVista,
    onVerOportunidades: (nombre) => {
      filtros.texto = nombre.toLowerCase();
      $("pl-f-texto").value = nombre;
      render();
      mostrarSub("tabla");
    },
    onAbrirDeal: (d) => {
      if (puedeEditar(d)) abrirModal(d);
      else toast(`Solo lectura: esta oportunidad es de ${d.rep || "otro rep"}`);
    }
  });
}

// ═══════════════════════════════════════════
// ⚡ CARGA MASIVA DE OPORTUNIDADES
// ═══════════════════════════════════════════
function mlFila() {
  return `<div class="ml-fila" style="display:grid;grid-template-columns:2fr 2fr 1.2fr 1.1fr .7fr 1.1fr 34px;gap:8px;margin-bottom:8px;align-items:center">
    <input class="form-input ml-opp" placeholder="Nombre de la oportunidad"/>
    <input class="form-input ml-cta" list="pl-dl-cuenta" placeholder="Cliente (de la lista)" autocomplete="off"/>
    <select class="form-select ml-est">${ESTADOS.map(e => `<option>${e}</option>`).join("")}</select>
    <input class="form-input ml-val" type="number" min="0" placeholder="0"/>
    <input class="form-input ml-pro" type="number" min="0" max="100" placeholder="50"/>
    <select class="form-select ml-mes"><option value="">—</option>${MESES.map(m => `<option>${m}</option>`).join("")}</select>
    <button class="btn-editar ml-quitar" type="button" title="Quitar fila" aria-label="Quitar fila">✕</button>
  </div>`;
}

function actualizarConteoML() {
  const n = $("ml-filas").querySelectorAll(".ml-fila").length;
  $("ml-conteo").textContent = `${n} fila(s)`;
}

function abrirModalMasiva() {
  $("ml-error").textContent = "";
  const selRep = $("ml-rep");
  if (selRep) {
    const actual = selRep.value;
    const nombres = [...new Set([...REPS_BASE, ...Object.keys(CUOTAS)])].sort((a, b) => a.localeCompare(b, "es"));
    selRep.innerHTML = `<option value="">Seleccionar...</option>` +
      nombres.map(r => `<option ${r === actual ? "selected" : ""}>${esc(r)}</option>`).join("");
  }
  $("ml-tipo").value = ""; $("ml-canal").value = "";
  poblarOrigen("ml-origen", "", "");
  poblarBrokersSelect("ml-broker", "");
  $("ml-brk-wrap").style.display = "none";
  $("ml-filas").innerHTML = mlFila() + mlFila() + mlFila();
  actualizarConteoML();
  $("ml-modal").classList.add("open");
}

async function guardarMasiva() {
  const err = $("ml-error");
  err.textContent = "";
  const u = obtenerUsuario();
  const rep = esAdmin() ? ($("ml-rep") ? $("ml-rep").value : "") : u.nombreRep;
  if (!rep) { err.textContent = "Selecciona el rep para las filas."; return; }
  const mlTipo = $("ml-tipo").value, mlCanal = $("ml-canal").value;
  const mlOrigen = mlCanal === "Indirecto" ? ORIGEN_INDIRECTO : $("ml-origen").value;
  if (!mlTipo || !mlCanal || !mlOrigen) { err.textContent = "Elige Tipo, Canal y Origen para las filas."; return; }
  let mlBroker = "";
  if (mlCanal === "Indirecto") {
    const b = brokerDe($("ml-broker").value);
    if (!b) { err.textContent = "Elige el broker para las filas."; return; }
    mlBroker = b.nombre;
  }

  const filas = [...$("ml-filas").querySelectorAll(".ml-fila")];
  const porCrear = [];
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const opp = f.querySelector(".ml-opp").value.trim();
    const cta = f.querySelector(".ml-cta").value.trim();
    const est = f.querySelector(".ml-est").value;
    const valStr = f.querySelector(".ml-val").value;
    const proStr = f.querySelector(".ml-pro").value;
    const mes = f.querySelector(".ml-mes").value;
    if (!opp && !cta && !valStr) continue; // fila vacía: se ignora
    const val = parseFloat(valStr);
    if (!opp || !cta || isNaN(val)) {
      err.textContent = `Fila ${i + 1}: completa Oportunidad, Cuenta y Valor.`;
      return;
    }
    const c = cuentaDe(cta);
    if (!c) {
      err.textContent = `Fila ${i + 1}: “${cta}” no está en la base de cuentas. Elígela de la lista o créala primero.`;
      return;
    }
    const proPct = proStr === "" ? 50 : Math.min(Math.max(parseFloat(proStr) || 0, 0), 100);
    const { prob, esperado } = probYEsperado(est, val, proPct / 100);
    porCrear.push({
      oportunidad: opp, cuenta: c.nombre, cuentaId: c.clave, rep, estado: est,
      valor: val, prob, esperado,
      // Se crean en el año que se está viendo en pantalla
      mes_radicacion: mes, anio_radicacion: anioVista,
      tipo: mlTipo, canal: mlCanal, origen: mlOrigen, riesgo: "", segmento: c.segmento || "",
      broker: mlBroker, brokerId: mlBroker ? claveCuenta(mlBroker) : "",
      mes_inicio: "", motivo_perdida: "", comentarios: ""
    });
  }
  if (!porCrear.length) { err.textContent = "No hay filas con datos para crear."; return; }

  const btn = $("ml-guardar");
  btn.disabled = true;
  let creadas = 0;
  for (const d of porCrear) {
    btn.textContent = `Guardando ${creadas + 1}/${porCrear.length}...`;
    const res = await crearDeal(d);
    if (!res.ok) {
      btn.disabled = false; btn.textContent = "💾 Crear oportunidades";
      err.textContent = `Se crearon ${creadas}. Falló "${d.oportunidad}": ${res.error}`;
      return;
    }
    creadas++;
  }
  btn.disabled = false; btn.textContent = "💾 Crear oportunidades";
  $("ml-modal").classList.remove("open");
  toast(`✓ ${creadas} oportunidad(es) creadas`);
}
