// ═══════════════════════════════════════════════════════════
// sprint-cuentas.js — v1 (oct 2026)
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
import { suscribirCuentasSprint, actualizarCuentaSprint, importarCuentasSprint } from "./firestore-service.js";
import { REPS_SPRINT, PASOS_RUTA, SPRINT } from "./sprint-config.js";

export const RESULTADOS = ["Sin respuesta", "Contactado", "Interesado", "Chequeo agendado", "Cotización solicitada",
  "No interesado", "Dato errado", "Ya no existe"];
const CAMPOS_EDITABLES = ["contactoNombre", "contactoCargo", "contactoCorreo", "contactoTelefono", "resultado", "siguientePaso", "fechaPaso", "notas"];
const PLAN_KEYS = ["planDia1", "planDia2", "planDia5", "planDia8", "planDia12"];

let cuentas = [];
let parar = null;
let ctx = { gestiones: [], filtroRep: "" };
const f = { texto: "", prioridad: "", avance: "", resultado: "" };
let editando = null;
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
      <select class="filtro-select" id="bi-f-avance"><option value="">Avance: todos</option><option value="pendiente">Sin iniciar</option><option value="vencido">Paso vencido</option><option value="hoy">Paso para hoy</option><option value="curso">En ruta</option><option value="completa">Ruta completa</option></select>
      <select class="filtro-select" id="bi-f-res"><option value="">Resultado: todos</option><option value="__vacio">Sin resultado</option>${RESULTADOS.map(r => `<option>${r}</option>`).join("")}</select>
      <span class="filtro-conteo" id="bi-conteo"></span>
    </div>
    <div class="card"><div class="tbl-wrap"><table class="tbl" id="bi-tabla">
      <thead><tr><th></th><th>Cuenta</th><th>Qué se cotizó</th><th>Contacto</th><th>Ruta</th><th>Resultado</th><th></th></tr></thead>
      <tbody><tr><td colspan="7" class="lista-vacia">Cargando cuentas…</td></tr></tbody></table></div>
      <div style="text-align:center;margin-top:10px"><button class="btn-secundario" id="bi-mas" style="display:none">Ver más</button></div></div>

    <div class="modal-overlay" id="bi-modal">
      <div class="modal-box">
        <div class="modal-hdr"><span class="modal-title" id="bi-m-titulo">Cuenta</span><button class="modal-close" id="bi-m-cerrar">×</button></div>
        <div class="modal-body">
          <div class="bi-msg" id="bi-m-info" style="margin-bottom:14px"></div>
          <div class="form-grid">
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

  if (parar) parar();
  parar = suscribirCuentasSprint((lista) => { cuentas = lista; render(); }, () => {
    const tb = $("bi-tabla")?.querySelector("tbody");
    if (tb) tb.innerHTML = `<tr><td colspan="7" class="lista-vacia">⚠️ No se pudieron leer las cuentas. Revisa que las reglas de Firestore incluyan la colección cuentasSprint.</td></tr>`;
  });
}

export function detenerCuentas() {
  if (parar) { parar(); parar = null; }
  cuentas = []; editando = null; limite = 40;
  Object.keys(f).forEach(k => f[k] = "");
}

// sprint-view.js llama esto cada vez que cambian gestiones o el filtro de rep.
export function actualizarContextoCuentas(gestiones, filtroRep) {
  ctx = { gestiones, filtroRep };
  render();
}

// ═══════════════════════════════════════════
// CÁLCULO DE AVANCE (desde las gestiones de la Agenda)
// ═══════════════════════════════════════════
function avancePorCuenta() {
  const m = new Map();
  for (const g of ctx.gestiones) {
    if (g.sprintAccion !== "ruta" || !g.fecha || g.fecha < SPRINT.inicio || g.fecha > SPRINT.fin) continue;
    const k = norm(g.cuenta);
    if (!m.has(k)) m.set(k, { hechos: new Set(), dec: new Set(), ultimo: "" });
    const a = m.get(k);
    a.hechos.add(g.sprintPaso);
    if (g.sprintDecisor) a.dec.add(g.sprintPaso);
    if (g.fecha > a.ultimo) a.ultimo = g.fecha;
  }
  return m;
}

function estadoRuta(c, av) {
  const hechos = av?.hechos || new Set();
  const idx = PASOS_RUTA.findIndex(p => !hechos.has(p));
  const completa = idx === -1 || hechos.has(PASOS_RUTA[PASOS_RUTA.length - 1]);
  if (completa) return { codigo: "completa", idx: -1, hechos, dec: av?.dec || new Set() };
  const vence = c[PLAN_KEYS[idx]] || "";
  const t = hoy();
  let codigo = hechos.size ? "curso" : "pendiente";
  if (vence && vence < t) codigo = "vencido";
  else if (vence === t) codigo = "hoy";
  return { codigo, idx, vence, hechos, dec: av?.dec || new Set() };
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function render() {
  const tb = $("bi-tabla")?.querySelector("tbody");
  if (!tb) return;
  const av = avancePorCuenta();
  const base = cuentas.filter(c => !ctx.filtroRep || c.rep === ctx.filtroRep)
    .map(c => ({ c, r: estadoRuta(c, av.get(norm(c.cuenta))) }));

  // Tarjetas
  const n = (fn) => base.filter(fn).length;
  const tile = (lbl, v, sub) => `<div class="m-card"><div class="m-lbl">${lbl}</div><div class="m-val">${v}</div><div class="m-sub">${sub}</div></div>`;
  $("bi-tiles").innerHTML =
    tile("Cuentas asignadas", base.length, `${n(x => x.c.prioridad === "A")} de prioridad A`) +
    tile("En ruta", n(x => x.r.hechos.size > 0), `${n(x => x.r.codigo === "completa")} con ruta completa`) +
    tile("Pasos vencidos", n(x => x.r.codigo === "vencido"), `${n(x => x.r.codigo === "hoy")} para hoy`) +
    tile("Con dato de contacto", n(x => x.c.contactoCorreo || x.c.contactoTelefono), `${n(x => !x.c.contactoCorreo && !x.c.contactoTelefono)} sin contacto`);

  // Filtros
  const q = norm(f.texto);
  const orden = { vencido: 0, hoy: 1, curso: 2, pendiente: 3, completa: 4 };
  const prioOrden = { "En gestión": 0, A: 1, B: 2, C: 3 };
  const lista = base.filter(({ c, r }) =>
    (!f.prioridad || c.prioridad === f.prioridad) &&
    (!f.avance || r.codigo === f.avance) &&
    (!f.resultado || (f.resultado === "__vacio" ? !c.resultado : c.resultado === f.resultado)) &&
    (!q || norm([c.cuenta, c.queSeCotizo, c.contactoNombre, c.contactoCorreo, c.rep].join(" ")).includes(q)))
    .sort((a, b) => orden[a.r.codigo] - orden[b.r.codigo]
      || String(a.r.vence || "9").localeCompare(String(b.r.vence || "9"))
      || (prioOrden[a.c.prioridad] ?? 9) - (prioOrden[b.c.prioridad] ?? 9)
      || String(a.c.cuenta).localeCompare(String(b.c.cuenta)));
  $("bi-conteo").textContent = `${lista.length} de ${base.length} cuentas`;

  if (!cuentas.length) {
    $("bi-mas").style.display = "none";
    tb.innerHTML = `<tr><td colspan="7" class="lista-vacia">${esAdmin() ? "Aún no hay cuentas cargadas. Usa \"📥 Importar cuentas\" con el archivo JSON de la base instalada." : "Gerencia aún no ha cargado las cuentas de base instalada."}</td></tr>`;
    return;
  }
  if (!lista.length) { $("bi-mas").style.display = "none"; tb.innerHTML = `<tr><td colspan="7" class="lista-vacia">Ninguna cuenta coincide con los filtros.</td></tr>`; return; }

  const pill = { vencido: ["sp-bad", "Vencido"], hoy: ["sp-warn", "Hoy"], curso: ["sp-neu", "En ruta"], pendiente: ["sp-neu", "Sin iniciar"], completa: ["sp-ok", "Ruta completa"] };
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
    const pasos = `<div class="sp-pasos">${PASOS_RUTA.map(p => `<span class="sp-paso${r.hechos.has(p) ? " ok" : ""}${r.dec.has(p) ? " dec" : ""}" title="${p}">${p.match(/\d+/)[0]}</span>`).join("")}</div>`;
    const sig = r.codigo === "completa" ? "" : `<div class="bi-sub">${PASOS_RUTA[r.idx]} · ${fmtD(r.vence)}</div>`;
    const editable = puedeEditar(c);
    return `<tr>
      <td>${prio}</td>
      <td><strong>${esc(c.cuenta)}</strong><div class="bi-sub">${esc(c.rep)} · ${esc(c.estadoCrm || "")}</div></td>
      <td class="bi-cot">${esc(c.queSeCotizo || "Por confirmar")}<div class="bi-sub">${esc(c.aniosCotizados || "")}${c.fechaCotizacion ? ` · última: ${fmtD(c.fechaCotizacion)}` : ""}</div></td>
      <td>${contacto}</td>
      <td>${pasos}${sig}<div style="margin-top:4px"><span class="sp-pill ${pill[r.codigo][0]}">${pill[r.codigo][1]}</span></div></td>
      <td><div style="font-size:12px">${esc(c.resultado) || "—"}</div>${c.siguientePaso ? `<div class="bi-sub">${esc(c.siguientePaso)}${c.fechaPaso ? ` · ${fmtD(c.fechaPaso)}` : ""}</div>` : ""}</td>
      <td><div class="bi-acc">
        ${editable && r.codigo !== "completa" ? `<button class="bi-btn" data-paso="${esc(c.id)}" title="Registrar en la Agenda: ${esc(PASOS_RUTA[r.idx] || "")}">🚀 Paso</button>` : ""}
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
  $("bi-m-guardar").style.display = ed ? "" : "none";
  $("bi-m-error").textContent = "";
  $("bi-modal").classList.add("open");
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
    notas: $("bi-m-notas").value.trim()
  };
  if (datos.contactoCorreo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.contactoCorreo)) {
    $("bi-m-error").textContent = "El correo no tiene un formato válido."; return;
  }
  // Solo se envían los campos que cambiaron (las reglas solo permiten estos).
  const cambios = {};
  for (const k of CAMPOS_EDITABLES) if ((editando[k] || "") !== datos[k]) cambios[k] = datos[k];
  if (!Object.keys(cambios).length) { cerrar(); return; }
  const btn = $("bi-m-guardar"); btn.disabled = true; btn.textContent = "Guardando...";
  const res = await actualizarCuentaSprint(editando.id, cambios);
  btn.disabled = false; btn.textContent = "💾 Guardar";
  if (res.ok) { cerrar(); toast("✓ Cuenta actualizada"); }
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
