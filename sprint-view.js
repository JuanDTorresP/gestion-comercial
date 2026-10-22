// ═══════════════════════════════════════════════════════════
// sprint-view.js — v1 (Fase 1, oct 2026)
// Pestaña "🚀 Sprint" del CRM: tablero de SOLO LECTURA del
// Sprint de Tracción · Base Instalada + FLEX (26 oct 2026 – 22 ene 2027).
//
// Fuente de datos: la colección `gestiones` (Agenda). Cuenta las
// gestiones que tienen el campo `sprintAccion` y cuya fecha cae
// dentro del sprint. No escribe nada en Firestore.
//
// v1.1: sección "Base instalada · cuentas a recontactar"
// (sprint-cuentas.js, colección cuentasSprint).
//
// Fase 2 sumará la calificación de oportunidades (deals) y
// Fase 3 los rituales y la cosecha.
// ═══════════════════════════════════════════════════════════

import { esAdmin, obtenerUsuario } from "./auth-service.js";
import { suscribirGestiones } from "./firestore-service.js";
import { SPRINT, REPS_SPRINT, ACCIONES_SPRINT, PASOS_RUTA, METAS } from "./sprint-config.js";
import { montarCuentas, detenerCuentas, actualizarContextoCuentas } from "./sprint-cuentas.js";

// Días (desde el primer paso) en que vence cada paso de la ruta.
const OFFSET_PASO = [0, 1, 4, 7, 11];

let gestiones = [];
let parar = null;
let montado = false;
let filtroRep = "";

// ── Utilidades ──
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const hoy = () => iso(new Date());
const lunes = (s) => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
const fmtD = (s) => s ? parse(s).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : "—";
const diasEntre = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ═══════════════════════════════════════════
// CICLO DE VIDA (lo llama app.js)
// ═══════════════════════════════════════════
export function iniciarSprint() {
  const page = $("page-sprint");
  if (!page) return;
  if (!montado) { montar(page); montado = true; }
  if (parar) parar();
  parar = suscribirGestiones(
    (lista) => { gestiones = lista; render(); },
    () => { $("sp-estado").className = "estado-conexion error"; $("sp-estado").textContent = "⚠️ No se pudieron leer las gestiones. Recarga la página."; }
  );
}

export function detenerSprint() {
  if (parar) { parar(); parar = null; }
  detenerCuentas();
  gestiones = [];
  montado = false;
  filtroRep = "";
  const page = $("page-sprint");
  if (page) page.innerHTML = "";
}

// ═══════════════════════════════════════════
// ESTRUCTURA
// ═══════════════════════════════════════════
function montar(page) {
  page.innerHTML = `
    <style>
      .sp-hero{background:var(--txt);color:#fff;border-radius:var(--r);padding:18px 20px;display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between;margin-bottom:16px}
      .sp-hero h2{font-size:18px;font-weight:700}
      .sp-hero p{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px}
      .sp-clock{display:flex;align-items:center;gap:14px}
      .sp-clock b{font-size:22px;font-weight:700;white-space:nowrap}
      .sp-bar{width:180px;max-width:40vw;height:8px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden}
      .sp-bar i{display:block;height:100%;background:#4ade80}
      .sp-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
      .sp-grid2>.card{margin-bottom:0}
      .sp-funnel{display:flex;flex-direction:column;gap:9px}
      .sp-frow{display:grid;grid-template-columns:minmax(120px,170px) 1fr 70px;gap:10px;align-items:center;font-size:13px}
      .sp-track{position:relative;height:20px;background:var(--s2);border-radius:5px;overflow:hidden}
      .sp-track .t{position:absolute;inset:0 auto 0 0;background:#e2e1da}
      .sp-track .r{position:absolute;inset:0 auto 0 0;border-radius:5px}
      .sp-frow .f{text-align:right;font-variant-numeric:tabular-nums}
      .sp-frow.fase2{opacity:.45}
      .sp-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--txt3);margin-top:12px}
      .sp-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
      .sp-pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
      .sp-ok{background:var(--green-l);color:#15803d}.sp-warn{background:var(--amber-l);color:#b45309}
      .sp-bad{background:var(--red-l);color:#b91c1c}.sp-neu{background:var(--s2);color:var(--txt2)}
      .sp-num{text-align:center;font-variant-numeric:tabular-nums}
      .sp-pasos{display:flex;gap:4px}
      .sp-paso{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:var(--s2);color:var(--txt3)}
      .sp-paso.ok{background:var(--blue);color:#fff}
      .sp-paso.dec{box-shadow:0 0 0 2px #16a34a}
      .sp-hdr2{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .sp-nota{font-size:12px;color:var(--txt3);margin-top:4px}
      @media(max-width:560px){.sp-frow{grid-template-columns:105px 1fr 58px}}
    </style>

    <div class="sp-hero">
      <div>
        <h2>🚀 Sprint de Tracción · Base Instalada + FLEX</h2>
        <p>${fmtD(SPRINT.inicio)} 2026 – ${fmtD(SPRINT.fin)} 2027 · se alimenta de las gestiones de la Agenda marcadas como acción del sprint</p>
      </div>
      <div class="sp-clock"><b id="sp-clock">—</b><div class="sp-bar"><i id="sp-bar" style="width:0%"></i></div></div>
    </div>

    <div class="filtros-bar">
      <select class="filtro-select" id="sp-f-rep">
        <option value="">👥 Todo el equipo</option>
        ${REPS_SPRINT.map(r => `<option>${r}</option>`).join("")}
      </select>
      <span class="filtro-conteo" id="sp-conteo"></span>
    </div>
    <div class="estado-conexion cargando" id="sp-estado" style="margin-bottom:16px">⏳ Cargando gestiones…</div>

    <div class="m-grid" id="sp-tiles"></div>

    <p class="section-lbl">Embudo objetivo vs. real</p>
    <div class="sp-grid2">
      <div class="card"><div class="page-title" style="font-size:15px;margin-bottom:12px">Frente 1 · Base Instalada</div><div class="sp-funnel" id="sp-f1"></div></div>
      <div class="card"><div class="page-title" style="font-size:15px;margin-bottom:12px">Frente 2 · FLEX Showroom Vivo</div><div class="sp-funnel" id="sp-f2"></div></div>
    </div>
    <div class="sp-leg"><span><i style="background:#e2e1da"></i>Meta 90 días</span><span><i style="background:var(--blue)"></i>Avance real</span><span><i style="background:var(--green)"></i>Etapa cumplida</span><span>Las filas tenues llegan en la Fase 2 (calificación en el pipeline)</span></div>

    <p class="section-lbl" style="margin-top:20px" id="sp-sem-lbl">Tablero de métricas</p>
    <div class="card"><div class="tbl-wrap"><table class="tbl" id="sp-kpi">
      <thead><tr><th>Indicador</th><th class="sp-num">Esta semana</th><th class="sp-num">Meta semanal</th><th class="sp-num">Acumulado</th><th class="sp-num">Meta 90 días</th><th class="sp-num">Estado</th></tr></thead>
      <tbody></tbody></table></div></div>

    <p class="section-lbl">Avance por representante</p>
    <div class="card"><div class="tbl-wrap"><table class="tbl" id="sp-reps">
      <thead><tr><th>Rep</th><th class="sp-num">Cuentas en ruta</th><th class="sp-num">Pasos de ruta</th><th class="sp-num">Con decisor</th><th class="sp-num">Chequeos</th><th class="sp-num">Invitaciones FLEX</th><th class="sp-num">Jornadas FLEX</th><th class="sp-num">Referidos</th></tr></thead>
      <tbody></tbody></table></div>
      <div class="sp-nota">Acumulado del sprint · entre paréntesis, lo de esta semana.</div></div>

    <div class="sp-hdr2">
      <div><p class="section-lbl" style="margin:0">Ruta de contacto por cuenta</p>
        <div class="sp-nota">Para el stand-up: cada círculo es un paso (1 · 2 · 5 · 8 · 12). Borde verde = hubo decisor. El siguiente paso vence contando desde el Día 1.</div></div>
    </div>
    <div class="card"><div class="tbl-wrap"><table class="tbl" id="sp-ruta">
      <thead><tr><th>Cuenta</th><th>Rep</th><th>Pasos</th><th>Último</th><th>Siguiente paso</th><th class="sp-num">Estado</th></tr></thead>
      <tbody></tbody></table></div></div>

    <div id="sp-cuentas" style="margin-top:8px"></div>
  `;
  montarCuentas($("sp-cuentas"));
  $("sp-f-rep").addEventListener("change", (e) => { filtroRep = e.target.value; render(); });

  // Un vendedor ve por defecto su propio avance (puede cambiar a "Todo el equipo").
  const u = obtenerUsuario();
  if (!esAdmin() && u?.nombreRep && REPS_SPRINT.includes(u.nombreRep)) {
    filtroRep = u.nombreRep;
    $("sp-f-rep").value = filtroRep;
  }
}

// ═══════════════════════════════════════════
// CÁLCULOS
// ═══════════════════════════════════════════
function delSprint() {
  return gestiones.filter(g =>
    ACCIONES_SPRINT[g.sprintAccion] &&
    g.fecha >= SPRINT.inicio && g.fecha <= SPRINT.fin &&
    norm(g.rep).split(/\s+/)[0] !== "elizabeth" &&
    (!filtroRep || g.rep === filtroRep));
}

function semanaActual() {
  const t = hoy();
  return lunes(t < SPRINT.inicio ? SPRINT.inicio : t > SPRINT.fin ? SPRINT.fin : t);
}

function proporcionEsperada() {
  const t = hoy();
  if (t < SPRINT.inicio) return 0;
  if (t > SPRINT.fin) return 1;
  return (diasEntre(SPRINT.inicio, t) + 1) / SPRINT.dias;
}

function medir(lista) {
  const w = semanaActual();
  const enSem = (g) => g.fecha >= w && g.fecha <= addD(w, 6);
  const de = (acc) => lista.filter(g => g.sprintAccion === acc);
  const ruta = de("ruta");
  const dec = ruta.filter(g => g.sprintDecisor);
  const cuentas = (arr) => new Set(arr.map(g => norm(g.cuenta)).filter(Boolean)).size;
  const par = (arr) => ({ tot: arr.length, sem: arr.filter(enSem).length });
  return {
    w,
    cuentas: { tot: cuentas(ruta), sem: cuentas(ruta.filter(enSem)) },
    pasos: par(ruta),
    decisor: par(dec),
    chequeos: par(de("chequeo")),
    invitaciones: par(de("invitacion")),
    jornadas: par(de("jornada")),
    referidos: par(de("referido"))
  };
}

function pill(valor, meta) {
  const p = proporcionEsperada();
  if (p === 0) return `<span class="sp-pill sp-neu">Sin iniciar</span>`;
  if (valor >= meta) return `<span class="sp-pill sp-ok">Meta cumplida</span>`;
  const r = valor / (meta * p);
  if (r >= 1) return `<span class="sp-pill sp-ok">Al día</span>`;
  if (r >= 0.7) return `<span class="sp-pill sp-warn">Atrasado</span>`;
  return `<span class="sp-pill sp-bad">Crítico</span>`;
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function render() {
  if (!$("sp-tiles")) return;
  const lista = delSprint();
  const M = medir(lista);
  const t = hoy();

  // Reloj
  let txt, pct;
  if (t < SPRINT.inicio) { const n = diasEntre(t, SPRINT.inicio); txt = `Arranca en ${n} día${n === 1 ? "" : "s"}`; pct = 0; }
  else if (t > SPRINT.fin) { txt = "Sprint cerrado"; pct = 100; }
  else { const n = diasEntre(SPRINT.inicio, t) + 1; txt = `Día ${n} de ${SPRINT.dias}`; pct = Math.min(100, n / SPRINT.dias * 100); }
  $("sp-clock").textContent = txt;
  $("sp-bar").style.width = pct + "%";

  const est = $("sp-estado");
  est.className = "estado-conexion ok";
  est.textContent = t < SPRINT.inicio
    ? "✅ Conectado. El sprint aún no arranca: solo cuentan las gestiones con fecha desde el 26 oct."
    : "✅ Datos del equipo en vivo.";
  $("sp-conteo").textContent = `${lista.length} acciones del sprint registradas`;

  // Tarjetas
  const tile = (lbl, v, meta, sub) => `<div class="m-card"><div class="m-lbl">${lbl}</div><div class="m-val">${v}<span style="font-size:13px;color:var(--txt3);font-weight:500"> / ${meta}</span></div><div class="m-sub">${sub}</div></div>`;
  $("sp-tiles").innerHTML =
    tile("Cuentas contactadas", M.cuentas.tot, METAS.cuentasContactadas.total, `${M.cuentas.sem} esta semana`) +
    tile("Contactos con decisor", M.decisor.tot, METAS.conDecisor.total, `${M.decisor.sem} esta semana`) +
    tile("Invitaciones FLEX", M.invitaciones.tot, METAS.invitaciones.total, `${M.invitaciones.sem} esta semana`) +
    tile("Jornadas FLEX", M.jornadas.tot, METAS.jornadas.total, `${M.jornadas.sem} esta semana`);

  // Embudos
  const embudo = (id, filas) => {
    const max = Math.max(...filas.map(f => f[2]));
    $(id).innerHTML = filas.map(([n, real, meta, fase2]) => {
      const ok = real != null && real >= meta;
      return `<div class="sp-frow${fase2 ? " fase2" : ""}">
        <span>${n}</span>
        <div class="sp-track" role="img" aria-label="${n}: ${fase2 ? "Fase 2" : real + " de " + meta}">
          <span class="t" style="width:${meta / max * 100}%"></span>
          ${fase2 ? "" : `<span class="r" style="width:${Math.min(real, max) / max * 100}%;background:var(${ok ? "--green" : "--blue"})"></span>`}
        </div>
        <span class="f">${fase2 ? "Fase 2" : `<b>${real}</b> / ${meta}`}</span></div>`;
    }).join("");
  };
  embudo("sp-f1", [
    ["Cuentas contactadas", M.cuentas.tot, METAS.cuentasContactadas.total],
    ["Contactos con decisor", M.decisor.tot, METAS.conDecisor.total],
    ["Chequeos de espacio", M.chequeos.tot, METAS.chequeos.total],
    ["Calificadas (8+ puntos)", null, METAS.calificadasBase.total, true],
    ["Cotizaciones en reunión", null, METAS.cotizacionesBase.total, true],
    ["Proyectos cerrados", null, METAS.cerradosBase.total, true]
  ]);
  embudo("sp-f2", [
    ["Invitaciones", M.invitaciones.tot, METAS.invitaciones.total],
    ["Jornadas FLEX", M.jornadas.tot, METAS.jornadas.total],
    ["Calificadas (8+ puntos)", null, METAS.calificadasFlex.total, true],
    ["Cotizaciones en reunión", null, METAS.cotizacionesFlex.total, true],
    ["Proyectos cerrados", null, METAS.cerradosFlex.total, true]
  ]);

  // KPIs
  $("sp-sem-lbl").textContent = `Tablero de métricas · semana del ${fmtD(M.w)} al ${fmtD(addD(M.w, 4))}`;
  const filas = [
    ["Cuentas contactadas (ruta de 12 días)", M.cuentas, null, METAS.cuentasContactadas.total],
    ["Contactos efectivos con decisor", M.decisor, METAS.conDecisor.semanal, METAS.conDecisor.total],
    ["Chequeos de espacio realizados", M.chequeos, METAS.chequeos.semanal, METAS.chequeos.total],
    ["Invitaciones FLEX enviadas", M.invitaciones, METAS.invitaciones.semanal, METAS.invitaciones.total],
    ["Jornadas FLEX realizadas", M.jornadas, METAS.jornadas.semanal, METAS.jornadas.total],
    ["Referidos obtenidos (milla extra)", M.referidos, null, METAS.referidos.total]
  ];
  $("sp-kpi").querySelector("tbody").innerHTML = filas.map(([n, v, ms, mt]) => `
    <tr><td><strong>${n}</strong></td>
      <td class="sp-num">${v.sem}</td><td class="sp-num">${ms ?? "—"}</td>
      <td class="sp-num"><strong>${v.tot}</strong></td><td class="sp-num">${mt}</td>
      <td class="sp-num">${pill(v.tot, mt)}</td></tr>`).join("") +
    `<tr><td colspan="6" class="sp-nota">Fase 2: calificadas, cotizaciones, cierres, tasa de cierre y pérdidas con motivo · Fase 3: asistencia a rituales y cosecha.</td></tr>`;

  renderReps();
  renderRuta(lista);
  actualizarContextoCuentas(gestiones, filtroRep);
}

function renderReps() {
  const todos = gestiones.filter(g => ACCIONES_SPRINT[g.sprintAccion] && g.fecha >= SPRINT.inicio && g.fecha <= SPRINT.fin);
  const reps = filtroRep ? [filtroRep] : REPS_SPRINT;
  const c = (v) => `${v.tot} <span style="color:var(--txt3)">(${v.sem})</span>`;
  $("sp-reps").querySelector("tbody").innerHTML = reps.map(r => {
    const M = medir(todos.filter(g => g.rep === r));
    return `<tr><td><strong>${esc(r)}</strong></td>
      <td class="sp-num">${c(M.cuentas)}</td><td class="sp-num">${c(M.pasos)}</td><td class="sp-num">${c(M.decisor)}</td>
      <td class="sp-num">${c(M.chequeos)}</td><td class="sp-num">${c(M.invitaciones)}</td><td class="sp-num">${c(M.jornadas)}</td>
      <td class="sp-num">${c(M.referidos)}</td></tr>`;
  }).join("");
}

function renderRuta(lista) {
  const ruta = lista.filter(g => g.sprintAccion === "ruta");
  const porCuenta = new Map();
  for (const g of ruta) {
    const k = norm(g.cuenta) + "|" + g.rep;
    if (!porCuenta.has(k)) porCuenta.set(k, { cuenta: g.cuenta, rep: g.rep, items: [] });
    porCuenta.get(k).items.push(g);
  }
  const t = hoy();
  const filas = [...porCuenta.values()].map(x => {
    const hechos = new Set(x.items.map(g => g.sprintPaso));
    const conDec = new Set(x.items.filter(g => g.sprintDecisor).map(g => g.sprintPaso));
    const fechas = x.items.map(g => g.fecha).sort();
    const inicio = (x.items.find(g => g.sprintPaso === PASOS_RUTA[0])?.fecha) || fechas[0];
    const ultimo = fechas[fechas.length - 1];
    const idxSig = PASOS_RUTA.findIndex(p => !hechos.has(p));
    const cerrado = hechos.has(PASOS_RUTA[PASOS_RUTA.length - 1]) || idxSig === -1;
    const vence = cerrado ? null : addD(inicio, OFFSET_PASO[idxSig]);
    let estado, orden;
    if (cerrado) { estado = `<span class="sp-pill sp-ok">Ruta completa</span>`; orden = 3; }
    else if (vence < t) { estado = `<span class="sp-pill sp-bad">Vencido ${diasEntre(vence, t)} d</span>`; orden = 0; }
    else if (vence === t) { estado = `<span class="sp-pill sp-warn">Hoy</span>`; orden = 1; }
    else { estado = `<span class="sp-pill sp-neu">En curso</span>`; orden = 2; }
    return { x, hechos, conDec, ultimo, idxSig, cerrado, vence, estado, orden };
  }).sort((a, b) => a.orden - b.orden || String(a.vence).localeCompare(String(b.vence)));

  const tb = $("sp-ruta").querySelector("tbody");
  if (!filas.length) {
    tb.innerHTML = `<tr><td colspan="6" class="lista-vacia">Aún no hay cuentas en ruta. En la Agenda, registra una gestión y en "🚀 Sprint de Tracción" elige "Paso de la ruta de contacto" → Día 1 · Llamada.</td></tr>`;
    return;
  }
  tb.innerHTML = filas.map(f => `
    <tr><td><strong>${esc(f.x.cuenta)}</strong></td><td>${esc(f.x.rep)}</td>
      <td><div class="sp-pasos">${PASOS_RUTA.map(p => {
        const n = p.match(/\d+/)[0];
        return `<span class="sp-paso${f.hechos.has(p) ? " ok" : ""}${f.conDec.has(p) ? " dec" : ""}" title="${p}">${n}</span>`;
      }).join("")}</div></td>
      <td>${fmtD(f.ultimo)}</td>
      <td>${f.cerrado ? "—" : `${PASOS_RUTA[f.idxSig]} · ${fmtD(f.vence)}`}</td>
      <td class="sp-num">${f.estado}</td></tr>`).join("");
}
