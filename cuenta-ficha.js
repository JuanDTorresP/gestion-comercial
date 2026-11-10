// ═══════════════════════════════════════════════════════════
// cuenta-ficha.js — v1.0 (nov 2026)
// 📇 FICHA 360 DE UNA CUENTA: panel lateral con todo lo que se
// sabe de un cliente, juntando las 4 fuentes del CRM:
//   · cuentas        → ficha (segmento, contactos)
// v1.1 (nov 2026): segmento único Retail/Corporativo/Público, broker en
//   cada oportunidad y nombre oficial aunque la cuenta esté escrita distinto.
//   · deals          → oportunidades de TODOS los años y reps
//   · gestiones      → actividad y notas de la Agenda
//   · cuentasSprint  → datos de base instalada (Sprint)
//
// Visibilidad: todos (Gerencia y vendedores) ven el historial
// completo de la cuenta en modo lectura, para que nadie llegue a
// un cliente sin saber qué pasó antes. Editar sigue igual: cada
// quien solo edita lo suyo (lo imponen las reglas de Firestore).
//
// Uso (desde pipeline-view.js):
//   abrirFichaCuenta("Bancolombia", {
//     onVerOportunidades: (nombre) => …,  // filtra la tabla del pipeline
//     onAbrirDeal: (deal) => …            // abre el formulario de la oportunidad
//   });
//   alCambiarCuentas(fn)  → avisa cuando cambia la lista de cuentas
//   nombresCuentas()      → todos los nombres conocidos (buscador)
//   detenerFichaCuenta()  → al cerrar sesión
//
// Las suscripciones se abren la primera vez que se usa el módulo.
// ═══════════════════════════════════════════════════════════

import { obtenerUsuario, esAdmin } from "./auth-service.js";
import {
  suscribirGestiones, suscribirDeals, suscribirCuentas, suscribirCuentasSprint,
  crearCuenta, actualizarCuenta, agregarContactoCuenta, idCuenta
} from "./firestore-service.js";
import { SEGMENTOS, SEGMENTO_TXT, segmentoDeRegistro, normSegmento, nombrePreferido, canalDeDeal, origenDeDeal } from "./catalogos.js";

// ── Constantes ──
const ACTIVOS = new Set(["Identificado", "Cotizado", "En diseño", "Negociación"]);
const EST_STYLE = {
  "Cotizado":     { bg: "#EFF6FF", cl: "#1d4ed8" },
  "Identificado": { bg: "#EDE9FE", cl: "#6d28d9" },
  "Negociación":  { bg: "#DCFCE7", cl: "#15803d" },
  "On hold":      { bg: "#FEF3C7", cl: "#b45309" },
  "En diseño":    { bg: "#CCFBF1", cl: "#0f766e" },
  "Ganado":       { bg: "#DCFCE7", cl: "#15803d" },
  "Perdido":      { bg: "#FEE2E2", cl: "#b91c1c" }
};
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const REPS_EXCLUIDOS = ["elizabeth"];

// ── Estado ──
let gestiones = [], deals = [], fichas = [], sprint = [];
let paradas = [];
let iniciado = false;
let abierta = "";        // clave (idCuenta) de la cuenta abierta
let opciones = {};
let pestana = "resumen";
let filtroOpp = "todas";
let filtroLinea = "todo";
let textoLinea = "";
let limiteLinea = 30;
let chart = null;
const oyentes = new Set();

// ── Utilidades ──
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(); }
function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}
function fmtFull(n) { return "$ " + Math.round(parseFloat(n) || 0).toLocaleString("es-CO"); }
function badge(txt, s) {
  s = s || EST_STYLE[txt] || { bg: "#F3F4F6", cl: "#374151" };
  return txt ? `<span class="badge" style="background:${s.bg};color:${s.cl}">${esc(txt)}</span>` : "";
}
function pad(n) { return String(n).padStart(2, "0"); }
function claveFecha(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fechaCorta(f) {
  if (!f) return "—";
  const d = new Date(f + "T00:00:00");
  return isNaN(d) ? f : d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}
// Timestamp de Firestore / Date / texto → "AAAA-MM-DD"
function fechaDe(ts) {
  if (!ts) return "";
  if (typeof ts.toDate === "function") return claveFecha(ts.toDate());
  if (ts instanceof Date) return claveFecha(ts);
  if (typeof ts.seconds === "number") return claveFecha(new Date(ts.seconds * 1000));
  const s = String(ts);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}
function diasDesde(f) {
  if (!f) return null;
  const d = new Date(f + "T00:00:00");
  return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
}
function anioDe(d) {
  const n = parseInt(String(d.anio_radicacion ?? "").replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? "" : n;
}
function esperadoDe(d) {
  const v = parseFloat(d.valor) || 0;
  if (d.estado === "Ganado") return v;
  if (d.estado === "Perdido") return 0;
  const e = parseFloat(d.esperado);
  return isNaN(e) ? Math.round(v * (parseFloat(d.prob) || 0)) : e;
}
function excluido(rep) { return REPS_EXCLUIDOS.includes(norm(rep).split(/\s+/)[0]); }
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ═══════════════════════════════════════════
// DATOS
// ═══════════════════════════════════════════
function iniciar() {
  if (iniciado) return;
  iniciado = true;
  const listo = () => { oyentes.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); if (abierta) render(); };
  paradas = [
    suscribirGestiones((l) => { gestiones = l.filter(g => !excluido(g.rep)); listo(); }, () => {}),
    suscribirDeals((l) => { deals = l; listo(); }, () => {}),
    suscribirCuentas((l) => { fichas = l; listo(); }, () => {}),
    suscribirCuentasSprint((l) => { sprint = l; listo(); }, () => {})
  ];
}

export function detenerFichaCuenta() {
  paradas.forEach(p => { try { p && p(); } catch (e) { /* nada */ } });
  paradas = []; iniciado = false;
  gestiones = []; deals = []; fichas = []; sprint = [];
  oyentes.clear();
  cerrar();
}

// Resumen rápido de actividad de una cuenta (columna de la tabla Cuentas)
export function actividadCuenta(nombre) {
  const k = idCuenta(nombre);
  let n = 0, ultima = "";
  gestiones.forEach(g => {
    if (idCuenta(g.cuenta) !== k) return;
    n++;
    if ((g.fecha || "") > ultima) ultima = g.fecha || "";
  });
  return { gestiones: n, ultima, dias: diasDesde(ultima) };
}

// Avisa cuando cambian los datos (para refrescar buscadores)
export function alCambiarCuentas(fn) { iniciar(); oyentes.add(fn); return () => oyentes.delete(fn); }

// Todos los nombres de cuenta conocidos (ficha, agenda, pipeline, sprint)
export function nombresCuentas() {
  const m = new Map();
  const add = (n) => { const t = String(n || "").trim(); if (t && !m.has(idCuenta(t))) m.set(idCuenta(t), t); };
  fichas.forEach(f => add(f.nombre));
  deals.forEach(d => add(d.cuenta));
  gestiones.forEach(g => add(g.cuenta));
  sprint.forEach(s => add(s.cuenta));
  return [...m.values()].sort((a, b) => a.localeCompare(b, "es"));
}

// Reúne todo lo de una cuenta
function datosCuenta(clave) {
  const ficha = fichas.find(f => f.id === clave || idCuenta(f.nombre) === clave) || null;
  const gs = gestiones.filter(g => idCuenta(g.cuenta) === clave)
    .sort((a, b) => (String(b.fecha || "") + String(b.hora || "")).localeCompare(String(a.fecha || "") + String(a.hora || "")));
  const ds = deals.filter(d => idCuenta(d.cuenta) === clave);
  const sp = sprint.find(s => idCuenta(s.cuenta) === clave) || null;
  const variantes = {};
  [...ds.map(d => d.cuenta), ...gs.map(g => g.cuenta), sp?.cuenta].forEach(n => { const t = String(n || "").trim(); if (t) variantes[t] = (variantes[t] || 0) + 1; });
  const nombre = ficha?.nombre || nombrePreferido(variantes);

  // Segmento: ficha → gestión más reciente → pipeline
  let segmento = segmentoDeRegistro(ficha);
  for (const g of gs) { if (!segmento) segmento = segmentoDeRegistro(g); }
  for (const d of ds) { if (!segmento) segmento = normSegmento(d.segmento) || normSegmento(d.canal); }

  // Contactos sin repetir, con la última vez que se usaron
  const contactos = [];
  const sumar = (c, origen) => {
    const nom = String(c?.nombre || "").trim();
    if (!nom) return;
    let x = contactos.find(y => norm(y.nombre) === norm(nom));
    if (!x) { x = { nombre: nom, cargo: "", correo: "", telefono: "", origen, ultimo: "", veces: 0 }; contactos.push(x); }
    ["cargo", "correo", "telefono"].forEach(k => { if (!x[k] && c[k]) x[k] = c[k]; });
  };
  (ficha?.contactos || []).forEach(c => sumar(c, "Ficha"));
  gs.forEach(g => {
    if (!g.contactoNombre) return;
    sumar({ nombre: g.contactoNombre, cargo: g.contactoCargo, correo: g.contactoCorreo, telefono: g.contactoTelefono }, "Agenda");
    const x = contactos.find(y => norm(y.nombre) === norm(g.contactoNombre));
    x.veces++;
    if (!x.ultimo || (g.fecha || "") > x.ultimo) x.ultimo = g.fecha || "";
  });
  if (sp?.contactoNombre) sumar({ nombre: sp.contactoNombre, cargo: sp.contactoCargo, correo: sp.contactoCorreo, telefono: sp.contactoTelefono }, "Base instalada");

  const reps = [...new Set([...ds.map(d => d.rep), ...gs.map(g => g.rep)].filter(r => r && !excluido(r)))];
  return { clave, nombre, ficha, gs, ds, sp, segmento, contactos, reps };
}

// ═══════════════════════════════════════════
// ABRIR / CERRAR
// ═══════════════════════════════════════════
export function abrirFichaCuenta(nombre, opts = {}) {
  if (!nombre) return;
  iniciar();
  pintarContenedor();
  abierta = idCuenta(nombre);
  opciones = opts;
  pestana = "resumen"; filtroOpp = "todas"; filtroLinea = "todo"; textoLinea = ""; limiteLinea = 30;
  $("cf-ov").classList.add("open");
  document.body.style.overflow = "hidden";
  render();
}

function cerrar() {
  abierta = "";
  const ov = $("cf-ov");
  if (ov) ov.classList.remove("open");
  document.body.style.overflow = "";
  if (chart) { chart.destroy(); chart = null; }
}

function pintarContenedor() {
  if ($("cf-ov")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <style>
      .cf-ov{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:450;display:none}
      .cf-ov.open{display:block}
      .cf{position:fixed;top:0;right:0;bottom:0;width:min(780px,100vw);background:var(--bg);box-shadow:-12px 0 40px rgba(0,0,0,.25);display:flex;flex-direction:column}
      .cf-hdr{background:linear-gradient(135deg,#1e3a8a,#2563EB);color:#fff;padding:18px 20px 0}
      .cf-top{display:flex;gap:12px;align-items:flex-start}
      .cf-top h3{font-size:20px;font-weight:700;line-height:1.2}
      .cf-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .cf-chips .badge{background:rgba(255,255,255,.18)!important;color:#fff!important}
      .cf-x{margin-left:auto;background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;flex-shrink:0}
      .cf-x:hover{background:rgba(255,255,255,.3)}
      .cf-acc{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .cf-acc button{background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
      .cf-acc button:hover{background:rgba(255,255,255,.28)}
      .cf-tabs{display:flex;gap:2px;margin-top:14px;overflow-x:auto}
      .cf-tab{background:none;border:none;color:rgba(255,255,255,.75);padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px 8px 0 0;font-family:inherit;white-space:nowrap}
      .cf-tab.on{background:var(--bg);color:var(--txt)}
      .cf-body{padding:16px 20px 28px;overflow-y:auto;flex:1}
      .cf-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
      .cf-kpi{background:var(--surface);border:.5px solid var(--border);border-radius:var(--r);padding:12px 14px}
      .cf-kpi.clic{cursor:pointer}.cf-kpi.clic:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
      .cf-kpi .l{font-size:11px;color:var(--txt2)}
      .cf-kpi .v{font-size:20px;font-weight:700;margin-top:2px}
      .cf-kpi .s{font-size:11px;color:var(--txt3);margin-top:2px}
      .cf-card{background:var(--surface);border:.5px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-bottom:14px}
      .cf-card h4{font-size:11px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px}
      .cf-card h4 button{text-transform:none;letter-spacing:0;border:none;background:var(--blue-l);color:#1d4ed8;font-weight:600;font-size:11px;border-radius:99px;padding:3px 10px;cursor:pointer;font-family:inherit}
      .cf-dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px}
      .cf-dl dt{color:var(--txt2)}
      .cf-dl dd{font-weight:500}
      .cf-bar{height:10px;border-radius:99px;background:var(--s2);overflow:hidden;display:flex;margin:6px 0 4px}
      .cf-bar span{display:block;height:100%}
      .cf-leyenda{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--txt2)}
      .cf-leyenda i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
      .cf-pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
      .cf-pill{padding:5px 12px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .cf-pill.on{background:var(--blue);border-color:var(--blue);color:#fff}
      .cf-tbl{width:100%;border-collapse:collapse;font-size:12px}
      .cf-tbl th{text-align:left;font-weight:600;color:var(--txt2);padding:8px 6px;border-bottom:.5px solid var(--border);white-space:nowrap}
      .cf-tbl td{padding:9px 6px;border-bottom:.5px solid var(--border);vertical-align:top}
      .cf-tbl tr.clic{cursor:pointer}.cf-tbl tr.clic:hover td{background:var(--s2)}
      .cf-tbl .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
      .cf-sub{font-size:11px;color:var(--txt3);margin-top:2px}
      .cf-ev{display:grid;grid-template-columns:34px 1fr;gap:10px;padding:10px 0;border-bottom:.5px solid var(--border)}
      .cf-ev:last-child{border-bottom:none}
      .cf-ico{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px}
      .cf-ev-t{font-size:13px;font-weight:600}
      .cf-ev-m{font-size:11px;color:var(--txt3);margin-top:2px}
      .cf-ev-n{font-size:12px;color:var(--txt);margin-top:6px;background:var(--s2);border-radius:8px;padding:8px 10px;white-space:pre-wrap}
      .cf-ct{display:grid;grid-template-columns:38px 1fr;gap:10px;padding:10px 0;border-bottom:.5px solid var(--border);font-size:13px}
      .cf-ct:last-child{border-bottom:none}
      .cf-av{width:36px;height:36px;border-radius:50%;background:var(--purple-l);color:var(--purple);font-weight:700;display:flex;align-items:center;justify-content:center;font-size:13px}
      .cf-ct a{color:var(--blue);text-decoration:none}
      .cf-vacio{font-size:12px;color:var(--txt3);padding:10px 0}
      .cf-mas{border:none;background:none;color:var(--blue);font-weight:600;font-size:12px;cursor:pointer;padding:8px 0 0;font-family:inherit}
      .cf-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
      .cf-form .full{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
      .cf-err{font-size:12px;color:var(--red);grid-column:1/-1}
      @media(max-width:600px){.cf-hdr{padding:14px 14px 0}.cf-body{padding:14px}.cf-top h3{font-size:17px}.cf-dl{grid-template-columns:105px 1fr}.cf-form{grid-template-columns:1fr}.cf-tbl .ocultar-movil{display:none}}
    </style>
    <div class="cf-ov" id="cf-ov">
      <aside class="cf" role="dialog" aria-modal="true" aria-labelledby="cf-nombre">
        <div class="cf-hdr" id="cf-hdr"></div>
        <div class="cf-body" id="cf-body"></div>
      </aside>
    </div>`;
  document.body.appendChild(div);
  $("cf-ov").addEventListener("click", (e) => { if (e.target.id === "cf-ov") cerrar(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && abierta && !document.querySelector(".modal-overlay.open")) cerrar();
  });
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function render() {
  if (!abierta || !$("cf-ov")) return;
  const c = datosCuenta(abierta);
  if (!c.nombre) {
    $("cf-hdr").innerHTML = `<div class="cf-top"><h3>Cargando cuenta…</h3><button class="cf-x" id="cf-x">×</button></div>`;
    $("cf-body").innerHTML = `<div class="cf-vacio">⏳ Cargando datos…</div>`;
    $("cf-x").addEventListener("click", cerrar);
    return;
  }
  renderHeader(c);
  const body = $("cf-body");
  if (pestana === "resumen") body.innerHTML = htmlResumen(c);
  else if (pestana === "opps") body.innerHTML = htmlOportunidades(c);
  else if (pestana === "act") body.innerHTML = htmlActividad(c);
  else if (pestana === "cts") body.innerHTML = htmlContactos(c);
  activar(c);
}

function renderHeader(c) {
  const ganadas = c.ds.filter(d => d.estado === "Ganado").length;
  const tabs = [
    ["resumen", "📊 Resumen"],
    ["opps", `💼 Oportunidades (${c.ds.length})`],
    ["act", `🗒 Actividad y notas (${c.gs.length})`],
    ["cts", `👤 Contactos (${c.contactos.length})`]
  ];
  $("cf-hdr").innerHTML = `
    <div class="cf-top">
      <div style="min-width:0">
        <div style="font-size:11px;opacity:.75;font-weight:600;letter-spacing:.04em">📇 FICHA DE CUENTA</div>
        <h3 id="cf-nombre">${esc(c.nombre)}</h3>
        <div class="cf-chips">
          ${c.segmento ? badge(SEGMENTO_TXT[c.segmento]) : ""}
          ${ganadas ? badge("🏆 Cliente con negocios ganados") : ""}
          ${c.sp ? badge("🚀 Base instalada") : ""}
          ${c.reps.length ? badge("👥 " + c.reps.map(r => r.split(" ")[0]).join(", ")) : ""}
        </div>
      </div>
      <button class="cf-x" id="cf-x" title="Cerrar (Esc)" aria-label="Cerrar">×</button>
    </div>
    <div class="cf-acc">
      <button id="cf-btn-gestion">＋ Registrar gestión</button>
      ${c.ds.length && opciones.onVerOportunidades ? `<button id="cf-btn-tabla">📋 Ver en la tabla de oportunidades</button>` : ""}
    </div>
    <div class="cf-tabs">${tabs.map(([k, t]) => `<button class="cf-tab ${k === pestana ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>`;
  $("cf-x").addEventListener("click", cerrar);
  $("cf-hdr").querySelectorAll(".cf-tab").forEach(b => b.addEventListener("click", () => { pestana = b.dataset.tab; render(); $("cf-body").scrollTop = 0; }));
  $("cf-btn-gestion").addEventListener("click", () => {
    const nombre = c.nombre;
    cerrar();
    document.dispatchEvent(new CustomEvent("ficha:registrar-gestion", { detail: { cuenta: nombre } }));
  });
  const bt = $("cf-btn-tabla");
  if (bt) bt.addEventListener("click", () => { const n = c.nombre; cerrar(); opciones.onVerOportunidades(n); });
}

// ── Indicadores de negocio ──
function totales(c) {
  const t = { gan: { n: 0, v: 0 }, per: { n: 0, v: 0 }, act: { n: 0, v: 0, e: 0 }, hold: { n: 0, v: 0 } };
  c.ds.forEach(d => {
    const v = parseFloat(d.valor) || 0;
    if (d.estado === "Ganado") { t.gan.n++; t.gan.v += v; }
    else if (d.estado === "Perdido") { t.per.n++; t.per.v += v; }
    else if (d.estado === "On hold") { t.hold.n++; t.hold.v += v; }
    else if (ACTIVOS.has(d.estado)) { t.act.n++; t.act.v += v; t.act.e += esperadoDe(d); }
  });
  const cerradas = t.gan.n + t.per.n;
  t.tasaN = cerradas ? Math.round(t.gan.n / cerradas * 100) : null;
  t.tasaV = (t.gan.v + t.per.v) ? Math.round(t.gan.v / (t.gan.v + t.per.v) * 100) : null;
  return t;
}

function htmlResumen(c) {
  const t = totales(c);
  const ult = c.gs[0];
  const dias = diasDesde(ult?.fecha);
  const fechas = [
    ...c.gs.map(g => g.fecha).filter(Boolean),
    ...c.ds.map(d => fechaDe(d.creadoEn)).filter(Boolean)
  ].sort();
  const primera = fechas[0] || "";
  const com = c.gs.filter(g => g.tipo === "Comercial").length;
  const pres = c.gs.filter(g => g.modalidad === "Presencial").length;
  const motivos = {};
  c.ds.filter(d => d.estado === "Perdido").forEach(d => { const m = String(d.motivo_perdida || "").trim() || "Sin motivo"; motivos[m] = (motivos[m] || 0) + 1; });
  const totalV = t.gan.v + t.per.v + t.act.v + t.hold.v || 1;
  const seg = (v, color) => v ? `<span style="width:${v / totalV * 100}%;background:${color}"></span>` : "";
  const ultimasNotas = c.gs.filter(g => String(g.notas || "").trim()).slice(0, 3);
  const faltaDato = !c.segmento;

  return `
    <div class="cf-kpis">
      <div class="cf-kpi clic" data-ir="opps" data-f="Ganado"><div class="l">🏆 Ganado</div><div class="v" style="color:var(--green)">${fmt(t.gan.v)}</div><div class="s">${t.gan.n} oportunidad(es)</div></div>
      <div class="cf-kpi clic" data-ir="opps" data-f="activas"><div class="l">🔥 Pipeline activo</div><div class="v" style="color:var(--blue)">${fmt(t.act.v)}</div><div class="s">${t.act.n} abiertas · esperado ${fmt(t.act.e)}</div></div>
      <div class="cf-kpi clic" data-ir="opps" data-f="Perdido"><div class="l">❌ Perdido</div><div class="v" style="color:var(--red)">${fmt(t.per.v)}</div><div class="s">${t.per.n} oportunidad(es)</div></div>
      <div class="cf-kpi"><div class="l">🎯 Tasa de cierre</div><div class="v">${t.tasaN == null ? "—" : t.tasaN + "%"}</div><div class="s">${t.tasaN == null ? "sin oportunidades cerradas" : `de las cerradas · ${t.tasaV}% en valor`}</div></div>
      <div class="cf-kpi clic" data-ir="act"><div class="l">🗒 Gestiones</div><div class="v">${c.gs.length}</div><div class="s">${com} comerciales · ${pres} presenciales</div></div>
      <div class="cf-kpi clic" data-ir="act"><div class="l">⏱ Último contacto</div><div class="v" style="${dias != null && dias > 60 ? "color:var(--red)" : ""}">${dias == null ? "—" : dias === 0 ? "Hoy" : dias + " días"}</div><div class="s">${ult ? fechaCorta(ult.fecha) + " · " + esc((ult.rep || "").split(" ")[0]) : "sin gestiones registradas"}</div></div>
    </div>

    ${c.ds.length ? `<div class="cf-card">
      <h4>Valor por estado (todos los años)</h4>
      <div class="cf-bar">${seg(t.gan.v, "#16a34a")}${seg(t.act.v, "#2563EB")}${seg(t.hold.v, "#d97706")}${seg(t.per.v, "#dc2626")}</div>
      <div class="cf-leyenda">
        <span><i style="background:#16a34a"></i>Ganado ${fmt(t.gan.v)}</span>
        <span><i style="background:#2563EB"></i>Activo ${fmt(t.act.v)}</span>
        ${t.hold.n ? `<span><i style="background:#d97706"></i>On hold ${fmt(t.hold.v)}</span>` : ""}
        <span><i style="background:#dc2626"></i>Perdido ${fmt(t.per.v)}</span>
      </div>
      ${t.per.n ? `<div class="cf-sub" style="margin-top:8px">Motivos de pérdida: ${Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<b>${esc(m)}</b> (${n})`).join(" · ")}</div>` : ""}
    </div>` : ""}

    <div class="cf-card">
      <h4>Actividad de los últimos 12 meses</h4>
      <div style="height:150px;position:relative"><canvas id="cf-ch"></canvas></div>
    </div>

    <div class="cf-card">
      <h4>Datos de la cuenta ${faltaDato ? `<button id="cf-btn-completar">Completar datos</button>` : ""}</h4>
      <dl class="cf-dl">
        <dt>Segmento</dt><dd>${c.segmento ? SEGMENTO_TXT[c.segmento] : `<span class="cf-sub">Sin registrar</span>`}</dd>
        <dt>Reps</dt><dd>${c.reps.length ? c.reps.map(esc).join(", ") : "—"}</dd>
        <dt>Primer registro</dt><dd>${primera ? fechaCorta(primera) : "—"}</dd>
        <dt>Contacto principal</dt><dd>${c.contactos[0] ? esc(c.contactos[0].nombre) + (c.contactos[0].cargo ? ` · <span class="cf-sub">${esc(c.contactos[0].cargo)}</span>` : "") : "—"}</dd>
        ${c.ficha?.creadoPor ? `<dt>Ficha creada por</dt><dd>${esc(c.ficha.creadoPor)}${fechaDe(c.ficha.creadoEn) ? " · " + fechaCorta(fechaDe(c.ficha.creadoEn)) : ""}</dd>` : ""}
      </dl>
      <div id="cf-completar" style="display:none">
        <div class="cf-form">
          <select class="form-select" id="cf-segmento"><option value="">Segmento…</option>${SEGMENTOS.map(x => `<option value="${x}">${SEGMENTO_TXT[x]}</option>`).join("")}</select>
          <div class="cf-err" id="cf-completar-err"></div>
          <div class="full"><button class="btn-primario" id="cf-completar-ok">💾 Guardar</button></div>
        </div>
      </div>
    </div>

    ${c.sp ? `<div class="cf-card" style="background:var(--amber-l);border-color:#fde68a">
      <h4 style="color:#92400e">🚀 Base instalada · Sprint de Tracción</h4>
      <dl class="cf-dl">
        <dt>Responsable</dt><dd>${esc(c.sp.rep || "—")} · prioridad ${esc(c.sp.prioridad || "—")}</dd>
        <dt>Qué se cotizó</dt><dd>${esc(c.sp.queSeCotizo || "Por confirmar")}${c.sp.aniosCotizados ? ` <span class="cf-sub">(${esc(c.sp.aniosCotizados)})</span>` : ""}</dd>
        ${c.sp.resultado ? `<dt>Resultado</dt><dd>${esc(c.sp.resultado)}</dd>` : ""}
        ${c.sp.siguientePaso ? `<dt>Siguiente paso</dt><dd>${esc(c.sp.siguientePaso)}${c.sp.fechaPaso ? " · " + fechaCorta(c.sp.fechaPaso) : ""}</dd>` : ""}
        ${c.sp.notas ? `<dt>Notas</dt><dd style="white-space:pre-wrap">${esc(c.sp.notas)}</dd>` : ""}
      </dl>
    </div>` : ""}

    <div class="cf-card">
      <h4>Últimas notas ${c.gs.length ? `<button data-ir="act">Ver toda la actividad</button>` : ""}</h4>
      ${ultimasNotas.length ? ultimasNotas.map(htmlGestion).join("") : `<div class="cf-vacio">Aún no hay notas registradas para esta cuenta.</div>`}
    </div>`;
}

function htmlOportunidades(c) {
  const grupos = {
    todas: { t: "Todas", p: () => true },
    activas: { t: "Activas", p: d => ACTIVOS.has(d.estado) },
    Ganado: { t: "Ganadas", p: d => d.estado === "Ganado" },
    Perdido: { t: "Perdidas", p: d => d.estado === "Perdido" },
    "On hold": { t: "On hold", p: d => d.estado === "On hold" }
  };
  const orden = { "Negociación": 1, "En diseño": 2, "Cotizado": 3, "Identificado": 4, "On hold": 5, "Ganado": 6, "Perdido": 7 };
  const lista = c.ds.filter(grupos[filtroOpp].p)
    .sort((a, b) => (orden[a.estado] || 9) - (orden[b.estado] || 9) || (parseFloat(b.valor) || 0) - (parseFloat(a.valor) || 0));
  const suma = lista.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const u = obtenerUsuario();
  const puede = (d) => esAdmin() || d.rep === u?.nombreRep;
  return `
    <div class="cf-pills">
      ${Object.entries(grupos).map(([k, g]) => `<button class="cf-pill ${k === filtroOpp ? "on" : ""}" data-fo="${esc(k)}">${g.t} (${c.ds.filter(g.p).length})</button>`).join("")}
      <span class="cf-sub" style="margin-left:auto">Total: <b>${fmtFull(suma)}</b></span>
    </div>
    <div class="cf-card" style="padding:4px 12px">
      ${lista.length ? `<table class="cf-tbl">
        <thead><tr><th>Oportunidad</th><th>Estado</th><th class="num">Valor</th><th class="num ocultar-movil">Esperado</th><th class="ocultar-movil">Radicación</th></tr></thead>
        <tbody>${lista.map(d => `<tr class="${opciones.onAbrirDeal ? "clic" : ""}" data-deal="${esc(d.id)}" title="${puede(d) ? "Abrir oportunidad" : "Solo lectura: es de " + esc(d.rep)}">
          <td><b>${esc(d.oportunidad) || "(sin nombre)"}</b>
            <div class="cf-sub">${esc(d.rep || "—")}${d.tipo ? " · " + esc(d.tipo) : ""}${canalDeDeal(d) ? " · " + canalDeDeal(d) : ""}${origenDeDeal(d) ? " · " + esc(origenDeDeal(d)) : ""}${d.broker ? " · 🤝 " + esc(d.broker) : ""}</div>
            ${d.estado === "Perdido" && d.motivo_perdida ? `<div class="cf-sub" style="color:#b91c1c">Motivo: ${esc(d.motivo_perdida)}</div>` : ""}
            ${d.comentarios ? `<div class="cf-sub">💬 ${esc(d.comentarios)}</div>` : ""}</td>
          <td>${badge(d.estado)}</td>
          <td class="num" title="${fmtFull(d.valor)}"><b>${fmt(d.valor)}</b></td>
          <td class="num ocultar-movil">${ACTIVOS.has(d.estado) ? fmt(esperadoDe(d)) : "—"}</td>
          <td class="ocultar-movil">${d.mes_radicacion ? esc(d.mes_radicacion) : `<span class="cf-sub">sin mes</span>`} ${anioDe(d)}</td>
        </tr>`).join("")}</tbody></table>`
      : `<div class="cf-vacio">${c.ds.length ? "No hay oportunidades en este grupo." : "Esta cuenta aún no tiene oportunidades en el pipeline."}</div>`}
    </div>`;
}

// ── Línea de tiempo: gestiones + hitos de las oportunidades ──
function eventos(c) {
  const ev = [];
  c.gs.forEach(g => ev.push({ tipo: "gestion", fecha: g.fecha || "", orden: (g.fecha || "") + (g.hora || ""), g }));
  c.ds.forEach(d => {
    const fc = fechaDe(d.creadoEn);
    if (fc) ev.push({ tipo: "opp", fecha: fc, orden: fc + "00:00", d, accion: "creada" });
    if ((d.estado === "Ganado" || d.estado === "Perdido") && fechaDe(d.actualizadoEn)) {
      const fa = fechaDe(d.actualizadoEn);
      ev.push({ tipo: "opp", fecha: fa, orden: fa + "23:59", d, accion: d.estado });
    }
  });
  return ev.sort((a, b) => b.orden.localeCompare(a.orden));
}

function htmlGestion(g) {
  const etapa = g.etapaVenta || g.etapa || "";
  const ico = g.tipo === "Comercial" ? ["💼", "#EFF6FF"] : ["⚙️", "#F3F4F6"];
  return `<div class="cf-ev">
    <div class="cf-ico" style="background:${ico[1]}">${ico[0]}</div>
    <div>
      <div class="cf-ev-t">${esc(g.oportunidad || g.tipo || "Gestión")}</div>
      <div class="cf-ev-m">${fechaCorta(g.fecha)}${g.hora ? " · " + esc(g.hora) : ""} · ${esc(g.rep || "")}
        ${[g.tipo, etapa, g.negocio, g.modalidad].filter(Boolean).map(esc).map(x => " · " + x).join("")}
        ${g.contactoNombre ? " · 👤 " + esc(g.contactoNombre) : ""}${g.dealId ? " · 🔗 pipeline" : ""}${g.sprintAccion ? " · 🚀 sprint" : ""}</div>
      ${String(g.notas || "").trim() ? `<div class="cf-ev-n">${esc(g.notas)}</div>` : ""}
    </div></div>`;
}
function htmlEventoOpp(e) {
  const d = e.d;
  const cfg = e.accion === "creada" ? ["➕", "#EDE9FE", `Oportunidad creada: ${d.oportunidad || ""}`]
    : e.accion === "Ganado" ? ["🏆", "#DCFCE7", `Oportunidad ganada: ${d.oportunidad || ""}`]
    : ["❌", "#FEE2E2", `Oportunidad perdida: ${d.oportunidad || ""}`];
  return `<div class="cf-ev">
    <div class="cf-ico" style="background:${cfg[1]}">${cfg[0]}</div>
    <div>
      <div class="cf-ev-t">${esc(cfg[2])} · ${fmt(d.valor)}</div>
      <div class="cf-ev-m">${fechaCorta(e.fecha)} · ${esc(d.rep || "")}${e.accion === "creada" ? " · estado actual: " + esc(d.estado || "—") : " · fecha de la última actualización"}${e.accion === "Perdido" && d.motivo_perdida ? " · motivo: " + esc(d.motivo_perdida) : ""}</div>
      ${e.accion === "creada" && d.comentarios ? `<div class="cf-ev-n">${esc(d.comentarios)}</div>` : ""}
    </div></div>`;
}

function htmlActividad(c) {
  const todos = eventos(c);
  const filtros = {
    todo: { t: "Todo", p: () => true },
    notas: { t: "Solo con notas", p: e => e.tipo === "gestion" && String(e.g.notas || "").trim() },
    gestion: { t: "Gestiones", p: e => e.tipo === "gestion" },
    opp: { t: "Oportunidades", p: e => e.tipo === "opp" }
  };
  const txt = norm(textoLinea);
  const lista = todos.filter(filtros[filtroLinea].p).filter(e => {
    if (!txt) return true;
    const blob = e.tipo === "gestion"
      ? [e.g.notas, e.g.oportunidad, e.g.rep, e.g.contactoNombre, e.g.etapa].join(" ")
      : [e.d.oportunidad, e.d.rep, e.d.comentarios, e.d.motivo_perdida].join(" ");
    return norm(blob).includes(txt);
  });
  const vis = lista.slice(0, limiteLinea);
  return `
    <div class="cf-pills">
      ${Object.entries(filtros).map(([k, f]) => `<button class="cf-pill ${k === filtroLinea ? "on" : ""}" data-fl="${k}">${f.t} (${todos.filter(f.p).length})</button>`).join("")}
      <input class="filtro-input" id="cf-buscar" placeholder="🔍 Buscar en notas…" value="${esc(textoLinea)}" style="flex:1;min-width:160px"/>
    </div>
    <div class="cf-card" style="padding:4px 16px">
      ${vis.length ? vis.map(e => e.tipo === "gestion" ? htmlGestion(e.g) : htmlEventoOpp(e)).join("")
        : `<div class="cf-vacio">${todos.length ? "Nada coincide con el filtro." : "Aún no hay actividad registrada para esta cuenta."}</div>`}
      ${lista.length > limiteLinea ? `<button class="cf-mas" id="cf-mas">Ver ${Math.min(30, lista.length - limiteLinea)} más ▾</button>` : ""}
    </div>`;
}

function htmlContactos(c) {
  const ini = (n) => n.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return `
    <div class="cf-card">
      <h4>Contactos de la cuenta <button id="cf-btn-ct">＋ Agregar contacto</button></h4>
      <div id="cf-ct-form" style="display:none">
        <div class="cf-form">
          <input class="form-input" id="cf-ct-nombre" placeholder="Nombre *" maxlength="120"/>
          <input class="form-input" id="cf-ct-cargo" placeholder="Cargo" maxlength="120"/>
          <input class="form-input" id="cf-ct-correo" placeholder="Correo" type="email" maxlength="160"/>
          <input class="form-input" id="cf-ct-tel" placeholder="Teléfono" type="tel" maxlength="40"/>
          <div class="cf-err" id="cf-ct-err"></div>
          <div class="full"><button class="btn-secundario" id="cf-ct-cancelar">Cancelar</button><button class="btn-primario" id="cf-ct-ok">💾 Guardar contacto</button></div>
        </div>
      </div>
      ${c.contactos.length ? c.contactos.map(x => `<div class="cf-ct">
        <div class="cf-av">${esc(ini(x.nombre))}</div>
        <div>
          <b>${esc(x.nombre)}</b>${x.cargo ? ` <span class="cf-sub">· ${esc(x.cargo)}</span>` : ""}
          <div style="margin-top:3px">${[
            x.correo ? `✉️ <a href="mailto:${esc(x.correo)}">${esc(x.correo)}</a>` : "",
            x.telefono ? `📞 <a href="tel:${esc(x.telefono)}">${esc(x.telefono)}</a>` : ""
          ].filter(Boolean).join(" &nbsp; ") || `<span class="cf-sub">Sin correo ni teléfono</span>`}</div>
          <div class="cf-sub">Origen: ${esc(x.origen)}${x.veces ? ` · ${x.veces} gestión(es) · última ${fechaCorta(x.ultimo)}` : ""}</div>
        </div></div>`).join("")
      : `<div class="cf-vacio">Aún no hay contactos. Agrégalos aquí o al registrar una gestión.</div>`}
    </div>`;
}

// ═══════════════════════════════════════════
// EVENTOS DEL CONTENIDO
// ═══════════════════════════════════════════
function activar(c) {
  const body = $("cf-body");
  body.querySelectorAll("[data-ir]").forEach(el => el.addEventListener("click", () => {
    pestana = el.dataset.ir;
    if (el.dataset.f) filtroOpp = el.dataset.f;
    render(); body.scrollTop = 0;
  }));
  body.querySelectorAll("[data-fo]").forEach(el => el.addEventListener("click", () => { filtroOpp = el.dataset.fo; render(); }));
  body.querySelectorAll("[data-fl]").forEach(el => el.addEventListener("click", () => { filtroLinea = el.dataset.fl; limiteLinea = 30; render(); }));
  body.querySelectorAll("tr[data-deal]").forEach(tr => tr.addEventListener("click", () => {
    if (!opciones.onAbrirDeal) return;
    const d = deals.find(x => x.id === tr.dataset.deal);
    if (d) opciones.onAbrirDeal(d);
  }));
  const buscar = $("cf-buscar");
  if (buscar) buscar.addEventListener("input", () => {
    textoLinea = buscar.value; limiteLinea = 30;
    const pos = buscar.selectionStart;
    render();
    const b2 = $("cf-buscar"); b2.focus(); b2.setSelectionRange(pos, pos);
  });
  const mas = $("cf-mas");
  if (mas) mas.addEventListener("click", () => { limiteLinea += 30; render(); });

  // Completar canal / sector
  const bc = $("cf-btn-completar");
  if (bc) bc.addEventListener("click", () => { $("cf-completar").style.display = "block"; });
  const okc = $("cf-completar-ok");
  if (okc) okc.addEventListener("click", async () => {
    const segmento = $("cf-segmento")?.value || c.segmento;
    if (!segmento) { $("cf-completar-err").textContent = "Elige el segmento."; return; }
    okc.disabled = true;
    const res = await guardarFicha(c, { segmento });
    okc.disabled = false;
    if (res.ok) toast("✓ Datos de la cuenta guardados");
    else $("cf-completar-err").textContent = res.error;
  });

  // Agregar contacto
  const bct = $("cf-btn-ct");
  if (bct) bct.addEventListener("click", () => { $("cf-ct-form").style.display = "block"; $("cf-ct-nombre").focus(); });
  const cct = $("cf-ct-cancelar");
  if (cct) cct.addEventListener("click", () => { $("cf-ct-form").style.display = "none"; });
  const okct = $("cf-ct-ok");
  if (okct) okct.addEventListener("click", async () => {
    const nombre = $("cf-ct-nombre").value.trim();
    const correo = $("cf-ct-correo").value.trim();
    const err = $("cf-ct-err");
    if (!nombre) { err.textContent = "Escribe el nombre del contacto."; return; }
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { err.textContent = "El correo no es válido."; return; }
    if (c.contactos.some(x => norm(x.nombre) === norm(nombre))) { err.textContent = "Ese contacto ya está en la cuenta."; return; }
    okct.disabled = true;
    const u = obtenerUsuario();
    const ct = { nombre, cargo: $("cf-ct-cargo").value.trim(), correo, telefono: $("cf-ct-tel").value.trim(),
      creadoPor: u?.nombreRep || "Gerencia", fecha: claveFecha(new Date()) };
    const res = await guardarFicha(c, {}, ct);
    okct.disabled = false;
    if (res.ok) toast("✓ Contacto agregado a la cuenta");
    else err.textContent = res.error;
  });

  if (pestana === "resumen") graficaActividad(c);
  else if (chart) { chart.destroy(); chart = null; }
}

// Crea la ficha si no existe; si existe, completa datos o agrega el contacto.
async function guardarFicha(c, datos, contacto) {
  const u = obtenerUsuario();
  if (!c.ficha) {
    return crearCuenta(idCuenta(c.nombre), {
      nombre: c.nombre, segmento: datos.segmento || c.segmento || "",
      contactos: contacto ? [contacto] : [],
      creadoPor: u?.nombreRep || "Gerencia", origen: "Ficha de cuenta"
    });
  }
  const cambios = {};
  if (datos.segmento && !normSegmento(c.ficha.segmento)) cambios.segmento = datos.segmento;
  if (Object.keys(cambios).length) {
    const r = await actualizarCuenta(c.ficha.id, cambios);
    if (!r.ok) return r;
  }
  if (contacto) return agregarContactoCuenta(c.ficha.id, contacto);
  return { ok: true };
}

function graficaActividad(c) {
  const el = $("cf-ch");
  if (!el || typeof Chart === "undefined") return;
  const hoy = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const contar = (m, tipo) => c.gs.filter(g => String(g.fecha || "").slice(0, 7) === m && (tipo === "Comercial" ? g.tipo === "Comercial" : g.tipo !== "Comercial")).length;
  if (chart) chart.destroy();
  chart = new Chart(el, {
    type: "bar",
    data: {
      labels: meses.map(m => MESES[parseInt(m.slice(5)) - 1].slice(0, 3) + " " + m.slice(2, 4)),
      datasets: [
        { label: "Comerciales", data: meses.map(m => contar(m, "Comercial")), backgroundColor: "#2563EB", borderRadius: 3 },
        { label: "Operativas", data: meses.map(m => contar(m, "Operativo")), backgroundColor: "#9b9b96", borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}
