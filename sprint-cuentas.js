// ═══════════════════════════════════════════════════════════
// sprint-cuentas.js — v1.3 (oct 2026)
// v1.3: · Tarjetas clicables: filtran la tabla (como en el Pipeline);
//         clic de nuevo quita el filtro.
//       · Clic en el nombre de la cuenta → panel con su historial de
//         gestiones (evento "sprint:ver-gestiones" que atiende sprint-view).
// v1.2: · Calificación rápida "¿Tiene proyecto?" (🎯): Sí / Por definir /
//         No. Con "Sí" se puede crear la oportunidad en el Pipeline
//         (Identificado) y la cuenta sale de la ruta. Con "No" (o un
//         resultado como No interesado / Dato errado) también sale.
//       · Ruta calculada en sprint-ruta.js: pasos saltados no bloquean y
//         los vencimientos cuentan desde el último paso real.
// v1.1: Gerencia puede reasignar y eliminar cuentas, una por una
//       (desde el ✏️) o varias a la vez (casillas + barra de acciones).
// Sección "Base instalada · cuentas a recontactar" de la pestaña
// Sprint. La monta y la alimenta sprint-view.js.
//
// Datos: colección `cuentasSprint` (una por cuenta cotizada 2023–2025).
//   · Cada comercial ve y edita SUS cuentas: contacto, resultado,
//     siguiente paso y notas (lo imponen las reglas de Firestore).
//   · El avance de la ruta NO se escribe aquí: se calcula a partir de
//     las gestiones de la Agenda marcadas como "Paso de la ruta".
//   · Gerencia carga/actualiza la lista con "📥 Importar cuentas"
//     (archivo JSON). La importación nunca pisa lo que el comercial
//     ya haya llenado.
// ═══════════════════════════════════════════════════════════

import { esAdmin, obtenerUsuario } from "./auth-service.js";
import { suscribirCuentasSprint, actualizarCuentaSprint, importarCuentasSprint,
  reasignarCuentasSprint, eliminarCuentasSprint, crearDeal } from "./firestore-service.js";
import { REPS_SPRINT, PASOS_RUTA } from "./sprint-config.js";
import { agruparRuta, estadoRuta as calcRuta, pasosHtml } from "./sprint-ruta.js";

export const RESULTADOS = ["Sin respuesta", "Contactado", "Interesado", "Chequeo agendado", "Cotización solicitada",
  "No interesado", "Dato errado", "Ya no existe"];
const CAMPOS_EDITABLES = ["contactoNombre", "contactoCargo", "contactoCorreo", "contactoTelefono", "resultado", "siguientePaso", "fechaPaso", "notas",
  "proyecto", "proyectoDetalle", "proyectoMes", "proyectoValor", "fechaCalificacion"];
// Resultados que sacan la cuenta de la ruta (no hay a quién seguir llamando).
const RESULTADOS_CIERRAN = ["No interesado", "Dato errado", "Ya no existe"];
const PROYECTO_TXT = { si: "✅ Tiene proyecto", luego: "⏳ Por definir", no: "Sin proyecto" };
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const PLAN_KEYS = ["planDia1", "planDia2", "planDia5", "planDia8", "planDia12"];

let cuentas = [];
let parar = null;
let ctx = { gestiones: [], filtroRep: "" };
const f = { texto: "", prioridad: "", avance: "", resultado: "", tarjeta: "" };
// Filtros de las tarjetas (clave → { etiqueta, prueba sobre {c, r} })
const TARJETAS = {
  todas:      { t: "Todas", p: () => true },
  enruta:     { t: "En ruta", p: ({ r }) => r.hechos.size > 0 && ["curso", "hoy", "vencido"].includes(r.codigo) },
  vencidos:   { t: "Pasos vencidos y para hoy", p: ({ r }) => r.codigo === "vencido" || r.codigo === "hoy" },
  proyecto:   { t: "Calificadas (con proyecto, por definir o cerradas)", p: ({ c, r }) => !!c.proyecto || r.codigo === "cerrada" },
  sincontacto:{ t: "Sin dato de contacto", p: ({ c }) => !c.contactoCorreo && !c.contactoTelefono }
};
let editando = null;
let proyectoSel = "";   // valor elegido en el modal: "si" | "luego" | "no" | ""
const seleccion = new Set();   // ids marcados por Gerencia
let limite = 40;   // filas visibles; "Ver más" suma 40

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const pad = (n) => String(n).padStart(2, "0");
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtD = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "2-digit" }); };
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function slugCuenta(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "sin-nombre"; }
function puedeEditar(c) {
  const u = obtenerUsuario();
  return esAdmin() || (u?.nombreRep && u.nombreRep === c.rep);
}
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

// ═══════════════════════════════════════════
// CICLO DE VIDA
// ═══════════════════════════════════════════
export function montarCuentas(contenedor) {
  contenedor.innerHTML = `
    <style>
      .bi-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
      .bi-tools .filtro-input{min-width:180px}
      .bi-prio{display:inline-flex;width:24px;height:24px;border-radius:6px;align-items:center;justify-content:center;font-weight:700;font-size:12px}
      .bi-A{background:#1a1a18;color:#fff}.bi-B{background:#dbe4f3;color:#1e3a8a}.bi-C{background:var(--s2);color:var(--txt2)}.bi-G{background:var(--amber-l);color:#92400e;width:auto;padding:0 6px}
      .bi-sub{font-size:11px;color:var(--txt3);margin-top:2px}
      .bi-cot{max-width:260px;font-size:12px}
      .bi-contacto{font-size:12px;line-height:1.35}
      .bi-contacto a{color:var(--blue);text-decoration:none}
      .bi-falta{font-size:11px;color:var(--amber);font-weight:600}
      .bi-acc{display:flex;gap:4px;justify-content:flex-end}
      .bi-btn{border:none;background:var(--blue-l);color:#1d4ed8;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit}
      .bi-btn:hover{background:#dbeafe}
      .bi-msg{background:var(--s2);border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.45;color:var(--txt2)}
      #bi-tabla td{vertical-align:top}
      .bi-tile.on{box-shadow:0 0 0 2px var(--blue);background:var(--blue-l)}
      .bi-chip-f{display:inline-block;background:var(--blue);color:#fff;border-radius:99px;padding:2px 9px;font-weight:600;cursor:pointer}
      .bi-calif{border:1.5px solid #bfdbfe;background:var(--blue-l);border-radius:10px;padding:12px;margin-bottom:14px}
      .bi-calif .form-label{color:#1d4ed8}
      .bi-seg{display:flex;gap:6px;flex-wrap:wrap}
      .bi-seg button{flex:1;min-width:150px;padding:9px 10px;border-radius:8px;border:1.5px solid #e5e5e3;background:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--txt)}
      .bi-seg button[aria-pressed="true"]{border-color:var(--blue);background:var(--blue);color:#fff}
      .bi-seg button:disabled{cursor:not-allowed;opacity:.7}
      .sprint-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;padding:8px 0 0;cursor:pointer}
      .sprint-check input{width:16px;height:16px}
      .bi-bulk{position:sticky;top:60px;z-index:50;display:none;align-items:center;gap:8px;flex-wrap:wrap;background:var(--txt);color:#fff;border-radius:var(--r);padding:10px 14px;margin-bottom:12px;font-size:13px}
      .bi-bulk.on{display:flex}
      .bi-bulk select{padding:6px 10px;border-radius:6px;border:none;font-family:inherit;font-size:13px}
      .bi-bulk button{border:none;border-radius:6px;padding:6px 12px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}
      .bi-bulk .ok{background:var(--blue);color:#fff}.bi-bulk .del{background:#dc2626;color:#fff}.bi-bulk .x{background:rgba(255,255,255,.15);color:#fff}
      .bi-chk{width:16px;height:16px;cursor:pointer}
    </style>
    <div class="sp-hdr2">
      <div><p class="section-lbl" style="margin:0">Base instalada · cuentas a recontactar</p>
        <div class="sp-nota">Clientes cotizados 2023–2025. Usa "🚀 Paso" para registrar en la Agenda el siguiente paso de la ruta (queda con el nombre exacto de la cuenta).</div></div>
      <div id="bi-admin"></div>
    </div>
    <div class="m-grid" id="bi-tiles"></div>
    <div class="bi-tools">
      <input class="filtro-input" id="bi-f-texto" placeholder="🔍 Buscar cuenta, contacto o producto…"/>
      <select class="filtro-select" id="bi-f-prio"><option value="">Prioridad: todas</option><option>A</option><option>B</option><option>C</option><option value="En gestión">En gestión</option></select>
      <select class="filtro-select" id="bi-f-avance"><option value="">Avance: todos</option><option value="pendiente">Sin iniciar</option><option value="vencido">Paso vencido</option><option value="hoy">Paso para hoy</option><option value="curso">En ruta</option><option value="completa">Ruta completa</option><option value="conproyecto">Con proyecto</option><option value="cerrada">Cerradas (sin proyecto)</option></select>
      <select class="filtro-select" id="bi-f-res"><option value="">Resultado: todos</option><option value="__vacio">Sin resultado</option>${RESULTADOS.map(r => `<option>${r}</option>`).join("")}</select>
      <span class="filtro-conteo" id="bi-conteo"></span>
    </div>
    <div class="bi-bulk" id="bi-bulk">
      <strong id="bi-bulk-n">0 seleccionadas</strong>
      <span>· Reasignar a</span>
      <select id="bi-bulk-rep"><option value="">— Elegir comercial —</option>${REPS_SPRINT.map(r => `<option>${r}</option>`).join("")}</select>
      <button class="ok" id="bi-bulk-asignar">Reasignar</button>
      <button class="del" id="bi-bulk-borrar">🗑 Eliminar</button>
      <button class="x" id="bi-bulk-limpiar">Quitar selección</button>
    </div>
    <div class="card"><div class="tbl-wrap"><table class="tbl" id="bi-tabla">
      <thead><tr>${esAdmin() ? `<th><input type="checkbox" class="bi-chk" id="bi-sel-todo" title="Seleccionar las cuentas visibles"/></th>` : ""}<th></th><th>Cuenta</th><th>Qué se cotizó</th><th>Contacto</th><th>Ruta</th><th>Resultado</th><th></th></tr></thead>
      <tbody><tr><td colspan="8" class="lista-vacia">Cargando cuentas…</td></tr></tbody></table></div>
      <div style="text-align:center;margin-top:10px"><button class="btn-secundario" id="bi-mas" style="display:none">Ver más</button></div></div>

    <div class="modal-overlay" id="bi-modal">
      <div class="modal-box">
        <div class="modal-hdr"><span class="modal-title" id="bi-m-titulo">Cuenta</span><button class="modal-close" id="bi-m-cerrar">×</button></div>
        <div class="modal-body">
          <div class="bi-msg" id="bi-m-info" style="margin-bottom:14px"></div>
          <div class="bi-calif">
            <label class="form-label">🎯 ¿El cliente tiene un proyecto?</label>
            <div class="bi-seg" id="bi-m-proy">
              <button type="button" data-v="si">✅ Sí, tiene proyecto</button>
              <button type="button" data-v="luego">⏳ Por definir</button>
              <button type="button" data-v="no">❌ No tiene proyecto</button>
            </div>
            <div class="sp-nota" id="bi-m-proy-nota"></div>
            <div id="bi-m-proy-si" style="display:none;margin-top:10px">
              <div class="form-grid">
                <div class="form-group full"><label class="form-label">¿Qué necesita?</label><input class="form-input" id="bi-m-pdet" maxlength="150" placeholder="Ej. Remodelación piso 3, 80 puestos"/></div>
                <div class="form-group"><label class="form-label">¿Para cuándo? (mes)</label><input class="form-input" id="bi-m-pmes" type="month"/></div>
                <div class="form-group"><label class="form-label">Valor estimado (COP)</label><input class="form-input" id="bi-m-pval" type="number" min="0" step="1000000" placeholder="0"/></div>
              </div>
              <label class="sprint-check" id="bi-m-deal-wrap" style="color:#1d4ed8"><input type="checkbox" id="bi-m-deal" checked/> Crear la oportunidad en el Pipeline (estado Identificado)</label>
              <div class="sp-nota" id="bi-m-deal-ok" style="display:none">🔗 Esta cuenta ya tiene su oportunidad en el Pipeline.</div>
            </div>
          </div>
          <div class="form-grid">
            <div class="form-group full" id="bi-m-rep-wrap" style="display:none"><label class="form-label">Responsable (solo Gerencia)</label>
              <select class="form-select" id="bi-m-rep">${REPS_SPRINT.map(r => `<option>${r}</option>`).join("")}</select></div>
            <div class="form-group"><label class="form-label">Nombre del contacto</label><input class="form-input" id="bi-m-nombre" maxlength="120"/></div>
            <div class="form-group"><label class="form-label">Cargo</label><input class="form-input" id="bi-m-cargo" maxlength="120"/></div>
            <div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="bi-m-correo" type="email" maxlength="160"/></div>
            <div class="form-group"><label class="form-label">Teléfono / WhatsApp</label><input class="form-input" id="bi-m-tel" maxlength="60"/></div>
            <div class="form-group"><label class="form-label">Resultado</label><select class="form-select" id="bi-m-res"><option value="">— Sin resultado —</option>${RESULTADOS.map(r => `<option>${r}</option>`).join("")}</select></div>
            <div class="form-group"><label class="form-label">Fecha siguiente paso</label><input class="form-input" id="bi-m-fecha" type="date"/></div>
            <div class="form-group full"><label class="form-label">Siguiente paso</label><input class="form-input" id="bi-m-sig" maxlength="200" placeholder="Ej. Reunión con compras para chequeo de espacio"/></div>
            <div class="form-group full"><label class="form-label">Notas</label><textarea class="form-input" id="bi-m-notas" rows="3" maxlength="800"></textarea></div>
          </div>
          <div class="login-error" id="bi-m-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-peligro" id="bi-m-eliminar" style="display:none">🗑 Eliminar cuenta</button>
          <button class="btn-secundario" id="bi-m-cancelar">Cancelar</button>
          <button class="btn-primario" id="bi-m-guardar">💾 Guardar</button>
        </div>
      </div>
    </div>
  `;
  if (esAdmin()) {
    $("bi-admin").innerHTML = `<button class="btn-secundario" id="bi-import-btn">📥 Importar cuentas</button><input type="file" id="bi-import-file" accept=".json,application/json" style="display:none"/>`;
    $("bi-import-btn").addEventListener("click", () => $("bi-import-file").click());
    $("bi-import-file").addEventListener("change", importar);
  }
  $("bi-f-texto").addEventListener("input", (e) => { f.texto = e.target.value; limite = 40; render(); });
  $("bi-f-prio").addEventListener("change", (e) => { f.prioridad = e.target.value; limite = 40; render(); });
  $("bi-f-avance").addEventListener("change", (e) => { f.avance = e.target.value; limite = 40; render(); });
  $("bi-f-res").addEventListener("change", (e) => { f.resultado = e.target.value; limite = 40; render(); });
  $("bi-mas").addEventListener("click", () => { limite += 40; render(); });
  $("bi-m-cerrar").addEventListener("click", cerrar);
  $("bi-m-cancelar").addEventListener("click", cerrar);
  $("bi-m-guardar").addEventListener("click", guardar);
  $("bi-m-eliminar").addEventListener("click", eliminarUna);
  $("bi-m-proy").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    proyectoSel = proyectoSel === b.dataset.v ? "" : b.dataset.v;   // clic de nuevo = desmarcar
    pintarProyecto();
  }));
  if (esAdmin()) {
    $("bi-sel-todo").addEventListener("change", (e) => {
      document.querySelectorAll("#bi-tabla [data-sel]").forEach(ch => {
        ch.checked = e.target.checked;
        e.target.checked ? seleccion.add(ch.dataset.sel) : seleccion.delete(ch.dataset.sel);
      });
      pintarBulk();
    });
    $("bi-bulk-limpiar").addEventListener("click", () => { seleccion.clear(); render(); });
    $("bi-bulk-asignar").addEventListener("click", reasignarSeleccion);
    $("bi-bulk-borrar").addEventListener("click", eliminarSeleccion);
  }

  if (parar) parar();
  parar = suscribirCuentasSprint((lista) => {
    cuentas = lista; render();
    document.dispatchEvent(new CustomEvent("sprint:cuentas-actualizadas"));
  }, () => {
    const tb = $("bi-tabla")?.querySelector("tbody");
    if (tb) tb.innerHTML = `<tr><td colspan="8" class="lista-vacia">⚠️ No se pudieron leer las cuentas. Revisa que las reglas de Firestore incluyan la colección cuentasSprint.</td></tr>`;
  });
}

export function detenerCuentas() {
  if (parar) { parar(); parar = null; }
  cuentas = []; editando = null; limite = 40; seleccion.clear();
  Object.keys(f).forEach(k => f[k] = "");
}

// Nombres (normalizados) de las cuentas de la base instalada; sprint-view.js
// los usa para no repetirlas en la tabla "Otras cuentas en ruta".
export function nombresCuentasBase() { return new Set(cuentas.map(c => norm(c.cuenta))); }

// sprint-view.js llama esto cada vez que cambian gestiones o el filtro de rep.
export function actualizarContextoCuentas(gestiones, filtroRep) {
  ctx = { gestiones, filtroRep };
  render();
}

// ═══════════════════════════════════════════
// CÁLCULO DE AVANCE (desde las gestiones de la Agenda)
// ═══════════════════════════════════════════
function avancePorCuenta() { return agruparRuta(ctx.gestiones); }

// Estado de la cuenta: primero la calificación, luego la ruta.
function estadoRuta(c, av) {
  const r = calcRuta(av, c.planDia1);
  if (c.proyecto === "si") return { ...r, codigo: "conproyecto" };
  if (c.proyecto === "no" || RESULTADOS_CIERRAN.includes(c.resultado)) return { ...r, codigo: "cerrada" };
  return r;
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function render() {
  const tb = $("bi-tabla")?.querySelector("tbody");
  if (!tb) return;
  for (const id of [...seleccion]) if (!cuentas.some(c => c.id === id)) seleccion.delete(id);
  pintarBulk();
  const av = avancePorCuenta();
  const base = cuentas.filter(c => !ctx.filtroRep || c.rep === ctx.filtroRep)
    .map(c => ({ c, r: estadoRuta(c, av.get(norm(c.cuenta))) }));

  // Tarjetas
  const n = (fn) => base.filter(fn).length;
  const tile = (lbl, v, sub, k) => `<div class="m-card sp-clic bi-tile${f.tarjeta === k ? " on" : ""}" data-tarjeta="${k}" title="${f.tarjeta === k ? "Quitar el filtro" : "Filtrar la tabla"}"><div class="m-lbl">${lbl}</div><div class="m-val">${v}</div><div class="m-sub">${sub}</div></div>`;
  $("bi-tiles").innerHTML =
    tile("Cuentas asignadas", base.length, `${n(x => x.c.prioridad === "A")} de prioridad A`, "todas") +
    tile("En ruta", n(TARJETAS.enruta.p), `${n(x => x.r.codigo === "completa")} con ruta completa`, "enruta") +
    tile("Pasos vencidos", n(x => x.r.codigo === "vencido"), `${n(x => x.r.codigo === "hoy")} para hoy`, "vencidos") +
    tile("Con proyecto", n(x => x.c.proyecto === "si"), `${n(x => x.c.proyecto === "luego")} por definir · ${n(x => x.r.codigo === "cerrada")} cerradas`, "proyecto") +
    tile("Con dato de contacto", n(x => x.c.contactoCorreo || x.c.contactoTelefono), `${n(TARJETAS.sincontacto.p)} sin contacto`, "sincontacto");
  $("bi-tiles").querySelectorAll("[data-tarjeta]").forEach(t => t.addEventListener("click", () => {
    const k = t.dataset.tarjeta;
    f.tarjeta = (f.tarjeta === k || k === "todas") ? "" : k;
    limite = 40; render();
  }));

  // Filtros
  const q = norm(f.texto);
  const orden = { vencido: 0, hoy: 1, curso: 2, pendiente: 3, completa: 4, conproyecto: 5, cerrada: 6 };
  const prioOrden = { "En gestión": 0, A: 1, B: 2, C: 3 };
  const filtroTarjeta = TARJETAS[f.tarjeta]?.p || (() => true);
  const lista = base.filter(({ c, r }) =>
    filtroTarjeta({ c, r }) &&
    (!f.prioridad || c.prioridad === f.prioridad) &&
    (!f.avance || r.codigo === f.avance) &&
    (!f.resultado || (f.resultado === "__vacio" ? !c.resultado : c.resultado === f.resultado)) &&
    (!q || norm([c.cuenta, c.queSeCotizo, c.contactoNombre, c.contactoCorreo, c.rep].join(" ")).includes(q)))
    .sort((a, b) => orden[a.r.codigo] - orden[b.r.codigo]
      || String(a.r.vence || "9").localeCompare(String(b.r.vence || "9"))
      || (prioOrden[a.c.prioridad] ?? 9) - (prioOrden[b.c.prioridad] ?? 9)
      || String(a.c.cuenta).localeCompare(String(b.c.cuenta)));
  $("bi-conteo").innerHTML = `${lista.length} de ${base.length} cuentas` +
    (f.tarjeta ? ` · <span class="bi-chip-f" id="bi-quitar-tarjeta" title="Quitar filtro">${TARJETAS[f.tarjeta].t} ✕</span>` : "");
  $("bi-quitar-tarjeta")?.addEventListener("click", () => { f.tarjeta = ""; render(); });

  if (!cuentas.length) {
    $("bi-mas").style.display = "none";
    tb.innerHTML = `<tr><td colspan="8" class="lista-vacia">${esAdmin() ? "Aún no hay cuentas cargadas. Usa \"📥 Importar cuentas\" con el archivo JSON de la base instalada." : "Gerencia aún no ha cargado las cuentas de base instalada."}</td></tr>`;
    return;
  }
  if (!lista.length) { $("bi-mas").style.display = "none"; tb.innerHTML = `<tr><td colspan="8" class="lista-vacia">Ninguna cuenta coincide con los filtros.</td></tr>`; return; }

  const pill = { vencido: ["sp-bad", "Vencido"], hoy: ["sp-warn", "Hoy"], curso: ["sp-neu", "En ruta"], pendiente: ["sp-neu", "Sin iniciar"],
    completa: ["sp-ok", "Ruta completa"], conproyecto: ["sp-ok", "✅ Con proyecto"], cerrada: ["sp-neu", "Cerrada"] };
  const restantes = lista.length - limite;
  $("bi-mas").style.display = restantes > 0 ? "" : "none";
  $("bi-mas").textContent = `Ver más (${restantes} restantes)`;
  tb.innerHTML = lista.slice(0, limite).map(({ c, r }) => {
    const prio = c.prioridad === "En gestión" ? `<span class="bi-prio bi-G" title="Ya tiene gestión abierta en el CRM">Gest.</span>` : `<span class="bi-prio bi-${esc(c.prioridad || "C")}">${esc(c.prioridad || "C")}</span>`;
    const contacto = (c.contactoNombre || c.contactoCorreo || c.contactoTelefono)
      ? `<div class="bi-contacto"><strong>${esc(c.contactoNombre) || "—"}</strong>${c.contactoCargo ? ` · ${esc(c.contactoCargo)}` : ""}
          ${c.contactoCorreo ? `<br><a href="mailto:${esc(c.contactoCorreo)}">${esc(c.contactoCorreo)}</a>` : ""}
          ${c.contactoTelefono ? `<br>${esc(c.contactoTelefono)}` : ""}</div>`
      : `<span class="bi-falta">Falta contacto</span>`;
    const pasos = pasosHtml(r);
    const activa = !["completa", "conproyecto", "cerrada"].includes(r.codigo);
    const sig = activa && r.idx >= 0 ? `<div class="bi-sub">${PASOS_RUTA[r.idx]} · ${fmtD(r.vence)}</div>` : "";
    const editable = puedeEditar(c);
    return `<tr>
      ${esAdmin() ? `<td><input type="checkbox" class="bi-chk" data-sel="${esc(c.id)}" ${seleccion.has(c.id) ? "checked" : ""}/></td>` : ""}
      <td>${prio}</td>
      <td><strong class="sp-link" data-hist="${esc(c.cuenta)}" title="Ver el historial de gestiones">${esc(c.cuenta)}</strong><div class="bi-sub">${esc(c.rep)} · ${esc(c.estadoCrm || "")}</div></td>
      <td class="bi-cot">${esc(c.queSeCotizo || "Por confirmar")}<div class="bi-sub">${esc(c.aniosCotizados || "")}${c.fechaCotizacion ? ` · última: ${fmtD(c.fechaCotizacion)}` : ""}</div></td>
      <td>${contacto}</td>
      <td>${pasos}${sig}<div style="margin-top:4px"><span class="sp-pill ${pill[r.codigo][0]}">${pill[r.codigo][1]}</span></div></td>
      <td>${c.proyecto ? `<div style="font-size:12px;font-weight:600">${PROYECTO_TXT[c.proyecto] || ""}${c.proyecto === "si" && c.proyectoDetalle ? `: ${esc(c.proyectoDetalle)}` : ""}</div>` : ""}<div style="font-size:12px">${esc(c.resultado) || (c.proyecto ? "" : "—")}</div>${c.siguientePaso ? `<div class="bi-sub">${esc(c.siguientePaso)}${c.fechaPaso ? ` · ${fmtD(c.fechaPaso)}` : ""}</div>` : ""}</td>
      <td><div class="bi-acc">
        ${editable && activa ? `<button class="bi-btn" data-paso="${esc(c.id)}" title="Registrar en la Agenda: ${esc(PASOS_RUTA[r.idx] || "")}">🚀 Paso</button>` : ""}
        ${editable ? `<button class="bi-btn" data-calif="${esc(c.id)}" title="¿Tiene proyecto? Calificar la cuenta">🎯</button>` : ""}
        <button class="bi-btn" data-ver="${esc(c.id)}" title="${editable ? "Editar contacto y seguimiento" : "Ver detalle"}">${editable ? "✏️" : "👁"}</button>
      </div></td></tr>`;
  }).join("");

  tb.querySelectorAll("[data-paso]").forEach(b => b.addEventListener("click", () => {
    const c = cuentas.find(x => x.id === b.dataset.paso); if (!c) return;
    const r = estadoRuta(c, avancePorCuenta().get(norm(c.cuenta)));
    document.dispatchEvent(new CustomEvent("sprint:registrar-paso", {
      detail: { cuenta: c.cuenta, rep: c.rep, paso: PASOS_RUTA[r.idx], oportunidad: "Recontacto base instalada" }
    }));
  }));
  tb.querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => abrir(b.dataset.ver)));
  tb.querySelectorAll("[data-hist]").forEach(b => b.addEventListener("click", () =>
    document.dispatchEvent(new CustomEvent("sprint:ver-gestiones", { detail: { cuenta: b.dataset.hist } }))));
  tb.querySelectorAll("[data-calif]").forEach(b => b.addEventListener("click", () => abrir(b.dataset.calif)));
  tb.querySelectorAll("[data-sel]").forEach(ch => ch.addEventListener("change", () => {
    ch.checked ? seleccion.add(ch.dataset.sel) : seleccion.delete(ch.dataset.sel);
    pintarBulk();
  }));
  if ($("bi-sel-todo")) {
    const vis = [...tb.querySelectorAll("[data-sel]")];
    $("bi-sel-todo").checked = vis.length > 0 && vis.every(ch => ch.checked);
  }
}

// ═══════════════════════════════════════════
// ACCIONES DE GERENCIA (reasignar / eliminar)
// ═══════════════════════════════════════════
function pintarBulk() {
  const bar = $("bi-bulk"); if (!bar) return;
  bar.classList.toggle("on", esAdmin() && seleccion.size > 0);
  $("bi-bulk-n").textContent = `${seleccion.size} seleccionada${seleccion.size === 1 ? "" : "s"}`;
}

function resumenNombres(ids) {
  const n = ids.map(id => cuentas.find(c => c.id === id)?.cuenta).filter(Boolean);
  return n.slice(0, 6).join(", ") + (n.length > 6 ? ` y ${n.length - 6} más` : "");
}

async function reasignarSeleccion() {
  const rep = $("bi-bulk-rep").value;
  if (!rep) { toast("Elige a qué comercial reasignar"); return; }
  const ids = [...seleccion].filter(id => cuentas.find(c => c.id === id)?.rep !== rep);
  if (!ids.length) { toast(`Las cuentas seleccionadas ya son de ${rep}`); return; }
  if (!confirm(`¿Reasignar ${ids.length} cuenta${ids.length === 1 ? "" : "s"} a ${rep}?\n\n${resumenNombres(ids)}\n\nSe conservan el contacto, el resultado, las notas y los pasos ya registrados.`)) return;
  const res = await reasignarCuentasSprint(ids, rep);
  if (res.ok) { seleccion.clear(); $("bi-bulk-rep").value = ""; toast(`✓ ${ids.length} cuenta${ids.length === 1 ? "" : "s"} reasignada${ids.length === 1 ? "" : "s"} a ${rep}`); render(); }
  else toast("⚠️ " + res.error);
}

async function eliminarSeleccion() {
  const ids = [...seleccion];
  if (!ids.length) return;
  if (!confirm(`¿Eliminar ${ids.length} cuenta${ids.length === 1 ? "" : "s"} de la base instalada?\n\n${resumenNombres(ids)}\n\nSe pierden su contacto, resultado y notas. Las gestiones ya registradas en la Agenda no se borran. Esta acción no se puede deshacer.`)) return;
  const res = await eliminarCuentasSprint(ids);
  if (res.ok) { seleccion.clear(); toast(`🗑 ${ids.length} cuenta${ids.length === 1 ? "" : "s"} eliminada${ids.length === 1 ? "" : "s"}`); render(); }
  else toast("⚠️ " + res.error);
}

async function eliminarUna() {
  if (!editando || !esAdmin()) return;
  const c = editando;
  if (!confirm(`¿Eliminar la cuenta "${c.cuenta}" de la base instalada?\n\nSe pierden su contacto, resultado y notas. Las gestiones ya registradas en la Agenda no se borran. Esta acción no se puede deshacer.`)) return;
  const res = await eliminarCuentasSprint([c.id]);
  if (res.ok) { seleccion.delete(c.id); cerrar(); toast(`🗑 "${c.cuenta}" eliminada`); }
  else $("bi-m-error").textContent = res.error;
}

// ═══════════════════════════════════════════
// MODAL DE CONTACTO Y SEGUIMIENTO
// ═══════════════════════════════════════════
function abrir(id) {
  const c = cuentas.find(x => x.id === id); if (!c) return;
  editando = c;
  const ed = puedeEditar(c);
  $("bi-m-titulo").textContent = c.cuenta;
  $("bi-m-info").innerHTML = `
    <strong>${esc(c.rep)}</strong> · Prioridad ${esc(c.prioridad)} · ${esc(c.estadoCrm || "")}<br>
    <strong>Cotizado:</strong> ${esc(c.queSeCotizo || "Por confirmar")} (${esc(c.aniosCotizados || "")}${c.numCotizaciones ? `, ${c.numCotizaciones} archivos` : ""})<br>
    ${c.ultimaCotizacion ? `<strong>Última cotización:</strong> ${esc(c.ultimaCotizacion)}${c.fechaCotizacion ? ` · ${fmtD(c.fechaCotizacion)}` : ""}<br>` : ""}
    ${c.comercialOriginal ? `<strong>Comercial original:</strong> ${esc(c.comercialOriginal)}<br>` : ""}
    ${c.carpeta ? `<strong>Carpeta:</strong> Z:\\${esc(c.carpeta)}<br>` : ""}
    ${c.contactoFuente ? `<strong>Fuente del contacto:</strong> ${esc(c.contactoFuente)}<br>` : ""}
    ${c.mensajeSugerido ? `<div style="margin-top:8px"><strong>Mensaje sugerido:</strong> ${esc(c.mensajeSugerido)}</div>` : ""}`;
  const set = (i, v) => { $(i).value = v || ""; $(i).disabled = !ed; };
  set("bi-m-nombre", c.contactoNombre); set("bi-m-cargo", c.contactoCargo);
  set("bi-m-correo", c.contactoCorreo); set("bi-m-tel", c.contactoTelefono);
  set("bi-m-res", c.resultado); set("bi-m-fecha", c.fechaPaso);
  set("bi-m-sig", c.siguientePaso); set("bi-m-notas", c.notas);
  proyectoSel = c.proyecto || "";
  set("bi-m-pdet", c.proyectoDetalle); set("bi-m-pmes", c.proyectoMes); set("bi-m-pval", c.proyectoValor);
  $("bi-m-proy").querySelectorAll("button").forEach(b => b.disabled = !ed);
  $("bi-m-deal").checked = !c.dealId; $("bi-m-deal").disabled = !ed;
  pintarProyecto();
  $("bi-m-guardar").style.display = ed ? "" : "none";
  $("bi-m-rep-wrap").style.display = esAdmin() ? "" : "none";
  $("bi-m-eliminar").style.display = esAdmin() ? "" : "none";
  if (esAdmin()) $("bi-m-rep").value = REPS_SPRINT.includes(c.rep) ? c.rep : REPS_SPRINT[0];
  $("bi-m-error").textContent = "";
  $("bi-modal").classList.add("open");
}
function pintarProyecto() {
  $("bi-m-proy").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === proyectoSel)));
  $("bi-m-proy-si").style.display = proyectoSel === "si" ? "" : "none";
  const tieneDeal = !!editando?.dealId;
  $("bi-m-deal-wrap").style.display = tieneDeal ? "none" : "";
  $("bi-m-deal-ok").style.display = tieneDeal ? "" : "none";
  $("bi-m-proy-nota").textContent = {
    si: "La cuenta sale de la ruta de contacto y queda como \"Con proyecto\".",
    luego: "La cuenta sigue en la ruta. Anota abajo el siguiente paso y su fecha.",
    no: "La cuenta sale de la ruta. Si quieres retomarla más adelante, anota la fecha en \"Siguiente paso\".",
    "": ""
  }[proyectoSel];
}

function cerrar() { $("bi-modal").classList.remove("open"); editando = null; }

async function guardar() {
  if (!editando) return;
  const datos = {
    contactoNombre: $("bi-m-nombre").value.trim(),
    contactoCargo: $("bi-m-cargo").value.trim(),
    contactoCorreo: $("bi-m-correo").value.trim(),
    contactoTelefono: $("bi-m-tel").value.trim(),
    resultado: $("bi-m-res").value,
    siguientePaso: $("bi-m-sig").value.trim(),
    fechaPaso: $("bi-m-fecha").value,
    notas: $("bi-m-notas").value.trim(),
    proyecto: proyectoSel,
    proyectoDetalle: proyectoSel === "si" ? $("bi-m-pdet").value.trim() : (editando.proyectoDetalle || ""),
    proyectoMes: proyectoSel === "si" ? $("bi-m-pmes").value : (editando.proyectoMes || ""),
    proyectoValor: proyectoSel === "si" ? $("bi-m-pval").value : (editando.proyectoValor || ""),
    fechaCalificacion: proyectoSel !== (editando.proyecto || "") ? (proyectoSel ? hoy() : "") : (editando.fechaCalificacion || "")
  };
  const crearOpp = proyectoSel === "si" && !editando.dealId && $("bi-m-deal").checked;
  if (crearOpp && (!datos.proyectoDetalle || !datos.proyectoMes || !(parseFloat(datos.proyectoValor) > 0))) {
    $("bi-m-error").textContent = "Para crear la oportunidad en el Pipeline completa qué necesita, el mes y el valor estimado (o desmarca la casilla).";
    return;
  }
  if (datos.contactoCorreo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.contactoCorreo)) {
    $("bi-m-error").textContent = "El correo no tiene un formato válido."; return;
  }
  // Solo se envían los campos que cambiaron (las reglas solo permiten estos).
  const cambios = {};
  for (const k of CAMPOS_EDITABLES) if (String(editando[k] ?? "") !== String(datos[k] ?? "")) cambios[k] = datos[k];
  // Gerencia también puede cambiar el responsable desde aquí.
  if (esAdmin() && $("bi-m-rep").value && $("bi-m-rep").value !== editando.rep) cambios.rep = $("bi-m-rep").value;
  if (!Object.keys(cambios).length && !crearOpp) { cerrar(); return; }
  const btn = $("bi-m-guardar"); btn.disabled = true; btn.textContent = "Guardando...";
  if (crearOpp) {
    // Oportunidad nueva en el Pipeline, a nombre del responsable de la cuenta.
    const [anio, mes] = datos.proyectoMes.split("-").map(Number);
    const valor = parseFloat(datos.proyectoValor), prob = 0.2;
    const rd = await crearDeal({
      oportunidad: datos.proyectoDetalle, cuenta: editando.cuenta, rep: editando.rep, estado: "Identificado",
      valor, prob, esperado: Math.round(valor * prob),
      mes_radicacion: MESES[mes - 1] || "", anio_radicacion: anio || new Date().getFullYear(),
      tipo: "", canal: "Corporativo", origen: "Sprint · Base instalada", riesgo: "", segmento: "", broker: "",
      mes_inicio: "", motivo_perdida: "", comentarios: "Creada desde la calificación de la base instalada (Sprint de Tracción)"
    });
    if (!rd.ok) { btn.disabled = false; btn.textContent = "💾 Guardar"; $("bi-m-error").textContent = "No se pudo crear la oportunidad: " + rd.error; return; }
    cambios.dealId = rd.id;
  }
  const res = await actualizarCuentaSprint(editando.id, cambios);
  btn.disabled = false; btn.textContent = "💾 Guardar";
  if (res.ok) { cerrar(); toast(cambios.dealId ? "✓ Cuenta calificada · oportunidad creada en el Pipeline" : cambios.rep ? `✓ Cuenta reasignada a ${cambios.rep}` : "✓ Cuenta actualizada"); }
  else $("bi-m-error").textContent = res.error;
}

// ═══════════════════════════════════════════
// IMPORTAR (solo Gerencia)
// Archivo JSON: [{ cuenta, rep, prioridad, ... }]
// ═══════════════════════════════════════════
const CAMPOS_BASE = ["cuenta", "rep", "prioridad", "segmento", "aniosCotizados", "queSeCotizo", "numCotizaciones", "estadoCrm",
  "comercialOriginal", "otrosComerciales", "ultimaCotizacion", "fechaCotizacion", "carpeta", "mensajeSugerido", ...PLAN_KEYS];
const CAMPOS_CONTACTO = ["contactoNombre", "contactoCargo", "contactoCorreo", "contactoTelefono", "contactoFuente"];

async function importar(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let filas;
  try { filas = JSON.parse(await file.text()); } catch { alert("El archivo no es un JSON válido."); return; }
  if (!Array.isArray(filas)) filas = filas?.cuentas;
  if (!Array.isArray(filas) || !filas.length) { alert("El archivo no trae cuentas."); return; }

  const errores = [];
  const porId = new Map(cuentas.map(c => [c.id, c]));
  const items = [];
  const vistos = new Set();
  filas.forEach((fila, i) => {
    if (!fila.cuenta || !REPS_SPRINT.includes(fila.rep)) { errores.push(`Fila ${i + 1}: falta cuenta o el responsable "${fila.rep}" no es del equipo`); return; }
    const id = slugCuenta(fila.cuenta);
    if (vistos.has(id)) { errores.push(`Fila ${i + 1}: "${fila.cuenta}" está repetida`); return; }
    vistos.add(id);
    const actual = porId.get(id);
    const datos = {};
    for (const k of CAMPOS_BASE) if (fila[k] !== undefined && fila[k] !== null) datos[k] = fila[k];
    // El contacto del archivo solo se usa si la cuenta aún no tiene ese dato.
    for (const k of CAMPOS_CONTACTO) if (fila[k] && !(actual && actual[k])) datos[k] = fila[k];
    if (!actual) { datos.resultado = ""; datos.siguientePaso = ""; datos.fechaPaso = ""; datos.notas = ""; }
    items.push({ id, datos });
  });

  const nuevas = items.filter(x => !porId.has(x.id)).length;
  const msg = `Se importarán ${items.length} cuentas (${nuevas} nuevas, ${items.length - nuevas} actualizadas).` +
    (errores.length ? `\n\n${errores.length} filas se omiten:\n${errores.slice(0, 8).join("\n")}` : "") +
    `\n\nLo que los comerciales ya llenaron (contacto, resultado, notas) no se modifica. ¿Continuar?`;
  if (!confirm(msg)) return;
  const btn = $("bi-import-btn"); btn.disabled = true; btn.textContent = "Importando...";
  const res = await importarCuentasSprint(items);
  btn.disabled = false; btn.textContent = "📥 Importar cuentas";
  toast(res.ok ? `✓ ${items.length} cuentas importadas` : "⚠️ " + res.error);
}
