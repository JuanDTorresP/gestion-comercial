// ═══════════════════════════════════════════════════════════
// agenda-view.js — v3
// Novedades sobre la v2:
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
  suscribirDeals, crearDeal, actualizarDeal
} from "./firestore-service.js";

// ── Constantes de negocio ──
const REPS_BASE = ["Patricia Lopera", "Clemencia Rodriguez", "Ivan Muñoz", "Johana Mayo"];
const ETAPAS = ["Identificado", "Seguimiento", "Cotización", "Diseño", "Negociación"];
const ETAPA_COLORS = { "Identificado": "#2563EB", "Seguimiento": "#7c3aed", "Cotización": "#d97706", "Diseño": "#dc2626", "Negociación": "#16a34a" };
const REP_COLORS = ["#2563EB", "#16a34a", "#7c3aed", "#d97706", "#dc2626", "#0d9488"];
const MESES_NOMBRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
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
let parar = null, pararDeals = null;
let editandoId = null;
let charts = {};
let semanaOffset = 0;
let semRep = "", semTipo = "", semMod = "";
let cmpA = "", cmpB = "";
let eqMes = "";
let mesInicializado = false;
const filtros = { texto: "", rep: "", tipo: "", etapa: "", mes: "", tipoCliente: "", canal: "", modalidad: "" };

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
  if (esAdmin()) return gestiones;
  const u = obtenerUsuario();
  return gestiones.filter(g => g.rep === u?.nombreRep);
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
          ${chip(g.canal, "#DCFCE7", "#15803d")}
          ${chip(g.modalidad, "#FEF3C7", "#b45309")}
          ${chip(g.tipoCliente === "Nuevo" ? "✨ Nuevo" : "", "#CCFBF1", "#0f766e")}
          ${chip(g.dealId ? "🔗 Pipeline" : "", "#EFF6FF", "#1d4ed8")}
          <span class="ag-ciudad">📍 ${esc(g.ciudad) || "—"}</span>
        </div>
        ${g.notas ? `<div class="ag-notas">${esc(g.notas)}</div>` : ""}
      </div>
      ${puedeEditar(g) ? `<button class="btn-editar" data-id="${g.id}" title="Editar gestión" aria-label="Editar gestión">✏️</button>` : ""}
    </div>`;
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
  semanaOffset = 0; semRep = ""; semTipo = ""; semMod = ""; cmpA = ""; cmpB = ""; mesInicializado = false;
  Object.keys(filtros).forEach(k => filtros[k] = "");
  pintarEstructura();
  if (parar) parar();
  parar = suscribirGestiones(
    (lista) => { gestiones = lista; actualizarOpcionesFiltros(); render(); },
    () => {
      $("ag-sub-sem").innerHTML =
        `<div class="estado-conexion error">✕ No se pudo conectar a la Agenda. Revisa tu conexión o tus permisos.</div>`;
    }
  );
  // También escuchamos las oportunidades del pipeline (para la trazabilidad)
  if (pararDeals) pararDeals();
  pararDeals = suscribirDeals(
    (lista) => { deals = lista; poblarSelectDeals(); },
    () => {}
  );
}

export function detenerAgenda() {
  if (parar) { parar(); parar = null; }
  if (pararDeals) { pararDeals(); pararDeals = null; }
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
  gestiones = [];
  deals = [];
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
      @media(max-width:820px){.pl-g2{grid-template-columns:1fr}.ag-hora{width:44px}}
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
      @media(max-width:820px){.cmp-heads{grid-template-columns:1fr}}
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
      <button class="ag-subtab" id="ag-st-cmp">🔁 Comparar meses</button>
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
      <p class="hint">💡 Haz clic en las tarjetas, en las barras o en la dona para filtrar la lista.</p>
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
      <div class="filtros-bar">
        <input class="filtro-input" id="ag-f-texto" placeholder="🔍 Buscar cuenta, oportunidad o ciudad..."/>
        <select class="filtro-select" id="ag-f-mes"><option value="">Mes: Todos</option></select>
        <select class="filtro-select" id="ag-f-rep" style="${esAdmin() ? "" : "display:none"}"><option value="">Rep: Todos</option></select>
        <select class="filtro-select" id="ag-f-tipo">
          <option value="">Tipo: Todos</option>
          <option>Comercial</option>
          <option>Operativo</option>
        </select>
        <select class="filtro-select" id="ag-f-canal">
          <option value="">Canal: Todos</option>
          <option>Retail</option>
          <option>Corporativo</option>
        </select>
        <select class="filtro-select" id="ag-f-modalidad">
          <option value="">Modalidad: Todas</option>
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

    <!-- ═══ COMPARAR MESES ═══ -->
    <div id="ag-sub-cmp" style="display:none">
      <div class="filtros-bar">
        <select class="filtro-select" id="cmp-a"></select>
        <span style="font-size:13px;color:var(--txt3)">vs</span>
        <select class="filtro-select" id="cmp-b"></select>
      </div>
      <div class="card">
        <p class="section-lbl">Comparativo</p>
        <table class="cmp-tbl" id="cmp-tabla"></table>
      </div>
      <div class="card">
        <p class="section-lbl">Gestiones por rep en cada mes</p>
        <div style="height:230px;position:relative"><canvas id="cmp-ch"></canvas></div>
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
            <div class="form-group"><label class="form-label">Ciudad *</label>
              <input class="form-input" id="ag-c-ciudad" list="ag-dl-ciudad" placeholder="Ciudad"/>
              <datalist id="ag-dl-ciudad"></datalist></div>
            <div class="form-group"><label class="form-label">Fecha *</label>
              <input class="form-input" id="ag-c-fecha" type="date"/></div>
            <div class="form-group"><label class="form-label">Hora</label>
              <input class="form-input" id="ag-c-hora" type="time"/></div>
            <div class="form-group full"><label class="form-label">Cuenta / Cliente *</label>
              <input class="form-input" id="ag-c-cuenta" list="ag-dl-cuenta" placeholder="Nombre del cliente"/>
              <datalist id="ag-dl-cuenta"></datalist></div>
            <div class="form-group full"><label class="form-label">Oportunidad *</label>
              <input class="form-input" id="ag-c-oportunidad" placeholder="Ej: Renovación contrato anual"/></div>
            <div class="form-group"><label class="form-label">Tipo de cliente *</label>
              <select class="form-select" id="ag-c-tipoCliente">
                <option value="">— Selecciona —</option>
                <option value="Nuevo">✨ Nuevo</option>
                <option value="Existente">🔁 Existente</option>
              </select></div>
            <div class="form-group"><label class="form-label">Canal *</label>
              <select class="form-select" id="ag-c-canal">
                <option value="">— Selecciona —</option>
                <option value="Retail">🏪 Retail</option>
                <option value="Corporativo">🏢 Corporativo</option>
              </select></div>
            <div class="form-group"><label class="form-label">Modalidad *</label>
              <select class="form-select" id="ag-c-modalidad">
                <option value="">— Selecciona —</option>
                <option value="Virtual">💻 Virtual</option>
                <option value="Presencial">🤝 Presencial</option>
              </select></div>
            <div class="form-group"><label class="form-label">Tipo de gestión *</label>
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

            <!-- 🔗 TRAZABILIDAD CON EL PIPELINE -->
            <div class="link-box" id="ag-link-wrap" style="display:none">
              <label class="form-label">🔗 Trazabilidad con el pipeline</label>
              <select class="form-select" id="ag-c-deal" style="width:100%">
                <option value="">— No vincular al pipeline —</option>
              </select>
              <div id="ag-link-campos" style="display:none;margin-top:10px">
                <div class="form-grid">
                  <div class="form-group"><label class="form-label">Estado de la oportunidad</label>
                    <select class="form-select" id="ag-c-deal-estado">
                      ${ESTADOS_PIPE.map(e => `<option>${e}</option>`).join("")}
                    </select></div>
                  <div class="form-group"><label class="form-label">Valor (COP)</label>
                    <input class="form-input" id="ag-c-deal-valor" type="number" min="0" placeholder="0"/></div>
                </div>
                <div class="link-nota" id="ag-link-nota"></div>
              </div>
            </div>

            <div class="form-group full"><label class="form-label">Descripción / Notas</label>
              <textarea class="form-input" id="ag-c-notas" rows="3" maxlength="500" placeholder="¿Qué pasó en la visita?"></textarea></div>
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
    $("ag-link-wrap").style.display = esComercial ? "block" : "none";
    if (!esComercial) { $("ag-c-etapa").value = ""; $("ag-c-deal").value = ""; alCambiarDeal(); }
  });
  $("ag-c-etapa").addEventListener("change", sugerirEstadoDesdeEtapa);
  $("ag-c-deal").addEventListener("change", alCambiarDeal);

  // Filtros del mensual
  $("ag-f-texto").addEventListener("input", (e) => { filtros.texto = e.target.value.toLowerCase(); renderMensual(); });
  [["ag-f-mes","mes"],["ag-f-rep","rep"],["ag-f-tipo","tipo"],["ag-f-etapa","etapa"],["ag-f-canal","canal"],["ag-f-modalidad","modalidad"]].forEach(([id, clave]) => {
    $(id).addEventListener("change", (e) => { filtros[clave] = e.target.value; renderMensual(); });
  });
  $("ag-f-limpiar").addEventListener("click", () => {
    Object.keys(filtros).forEach(k => filtros[k] = "");
    $("ag-f-texto").value = "";
    ["ag-f-mes","ag-f-rep","ag-f-tipo","ag-f-etapa","ag-f-canal","ag-f-modalidad"].forEach(id => $(id).value = "");
    renderMensual();
  });
  $("ag-btn-csv").addEventListener("click", exportarCSVAgenda);

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

  const reps = [...new Set([...REPS_BASE, ...gestiones.map(g => g.rep).filter(Boolean)])].sort();
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

  const dl = (id, campo) => {
    const vals = [...new Set(baseGestiones().map(g => String(g[campo] || "").trim()).filter(Boolean))].sort();
    const el = $(id);
    if (el) el.innerHTML = vals.map(v => `<option value="${esc(v)}">`).join("");
  };
  dl("ag-dl-ciudad", "ciudad");
  dl("ag-dl-cuenta", "cuenta");
}

// ═══════════════════════════════════════════
// 🔗 TRAZABILIDAD: selector de oportunidades
// ═══════════════════════════════════════════
function dealsElegibles() {
  // Gerencia puede vincular cualquier oportunidad;
  // un vendedor solo las suyas (las reglas lo exigen igual).
  const u = obtenerUsuario();
  const lista = esAdmin() ? deals : deals.filter(d => d.rep === u?.nombreRep);
  return [...lista].sort((a, b) => String(a.cuenta || "").localeCompare(String(b.cuenta || ""), "es"));
}

function poblarSelectDeals() {
  const sel = $("ag-c-deal");
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">— No vincular al pipeline —</option>` +
    `<option value="__nueva__">➕ Crear NUEVA oportunidad en el pipeline</option>` +
    dealsElegibles().map(d =>
      `<option value="${d.id}">${esc(d.cuenta)} — ${esc(d.oportunidad)} (${esc(d.estado)} · ${fmt(d.valor)})</option>`
    ).join("");
  if ([...sel.options].some(o => o.value === actual)) sel.value = actual;
}

function alCambiarDeal() {
  const val = $("ag-c-deal").value;
  const campos = $("ag-link-campos");
  const nota = $("ag-link-nota");

  if (!val) { campos.style.display = "none"; return; }
  campos.style.display = "block";

  if (val === "__nueva__") {
    $("ag-c-deal-valor").value = "";
    sugerirEstadoDesdeEtapa();
    nota.textContent = "Se creará en el pipeline usando la Cuenta y la Oportunidad de esta gestión.";
  } else {
    const d = deals.find(x => x.id === val);
    if (d) {
      $("ag-c-deal-valor").value = d.valor ?? "";
      const sugerido = MAPA_ETAPA_ESTADO[$("ag-c-etapa").value] || d.estado || "Identificado";
      $("ag-c-deal-estado").value = sugerido;
      nota.textContent = `La cuenta "${d.cuenta}" se mantiene. Se actualizarán el estado y el valor de la oportunidad.`;
    }
  }
}

function sugerirEstadoDesdeEtapa() {
  const val = $("ag-c-deal").value;
  if (!val) return;
  const sugerido = MAPA_ETAPA_ESTADO[$("ag-c-etapa").value];
  if (sugerido) $("ag-c-deal-estado").value = sugerido;
}

// ═══════════════════════════════════════════
// RENDER GENERAL
// ═══════════════════════════════════════════
function render() {
  renderMiAgenda();
  renderEquipo();
  renderSemana();
  renderMensual();
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
    filtros.etapa = ""; filtros.texto = ""; filtros.canal = ""; filtros.modalidad = "";
    $("ag-f-mes").value = mesClave; $("ag-f-tipo").value = filtros.tipo;
    $("ag-f-etapa").value = ""; $("ag-f-texto").value = "";
    $("ag-f-canal").value = ""; $("ag-f-modalidad").value = "";
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

  const delMes = eqMes ? gestiones.filter(g => mesDe(g) === eqMes) : gestiones;
  const reps = [...new Set([...REPS_BASE, ...gestiones.map(g => g.rep).filter(Boolean)])].sort();
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
    filtros.canal = ""; filtros.modalidad = "";
    $("ag-f-rep").value = filtros.rep;
    $("ag-f-mes").value = filtros.mes;
    $("ag-f-tipo").value = ""; $("ag-f-etapa").value = ""; $("ag-f-texto").value = "";
    $("ag-f-canal").value = ""; $("ag-f-modalidad").value = "";
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
function filtrarMensual() {
  return baseGestiones().filter(g => {
    if (filtros.mes && mesDe(g) !== filtros.mes) return false;
    if (filtros.rep && g.rep !== filtros.rep) return false;
    if (filtros.tipo && g.tipo !== filtros.tipo) return false;
    if (filtros.canal && g.canal !== filtros.canal) return false;
    if (filtros.modalidad && g.modalidad !== filtros.modalidad) return false;
    if (filtros.etapa && etapaDe(g) !== filtros.etapa) return false;
    if (filtros.tipoCliente && g.tipoCliente !== filtros.tipoCliente) return false;
    if (filtros.texto) {
      const blob = ((g.cuenta || "") + " " + (g.oportunidad || "") + " " + (g.ciudad || "")).toLowerCase();
      if (!blob.includes(filtros.texto)) return false;
    }
    return true;
  });
}

// Exporta a CSV las gestiones visibles con los filtros del reporte mensual
function exportarCSVAgenda() {
  const cols = ["fecha","hora","rep","cuenta","oportunidad","tipo","etapa","tipoCliente","canal","modalidad","ciudad","notas","dealId"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = filtrarMensual().map(g => cols.map(k => {
    if (k === "etapa") return etapaDe(g);
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

function renderMensual() {
  const visibles = filtrarMensual();

  const comerciales = visibles.filter(g => g.tipo === "Comercial");
  const operativas = visibles.filter(g => g.tipo === "Operativo");
  const cuentas = new Set(visibles.map(g => String(g.cuenta || "").trim()).filter(Boolean));
  const clientesNuevos = visibles.filter(g => g.tipoCliente === "Nuevo").length;

  $("ag-metricas").innerHTML = `
    <div class="m-card clic" id="mc-todas">
      <div class="m-lbl">Gestiones</div>
      <div class="m-val" style="color:var(--blue)">${visibles.length}</div>
      <div class="m-sub">${filtros.mes ? nombreMes(filtros.mes) : "todo el histórico"}</div></div>
    <div class="m-card clic ${filtros.tipo === "Comercial" ? "activa" : ""}" id="mc-com">
      <div class="m-lbl">Comerciales</div>
      <div class="m-val" style="color:var(--green)">${comerciales.length}</div>
      <div class="m-sub">clic para filtrar</div></div>
    <div class="m-card clic ${filtros.tipo === "Operativo" ? "activa" : ""}" id="mc-ope">
      <div class="m-lbl">Operativas</div>
      <div class="m-val" style="color:var(--amber)">${operativas.length}</div>
      <div class="m-sub">clic para filtrar</div></div>
    <div class="m-card"><div class="m-lbl">Cuentas visitadas</div>
      <div class="m-val">${cuentas.size}</div>
      <div class="m-sub">cuentas únicas</div></div>
    <div class="m-card clic ${filtros.tipoCliente === "Nuevo" ? "activa" : ""}" id="mc-nue">
      <div class="m-lbl">Clientes nuevos</div>
      <div class="m-val" style="color:var(--purple)">${clientesNuevos}</div>
      <div class="m-sub">clic para filtrar</div></div>
  `;
  $("mc-todas").addEventListener("click", () => {
    filtros.tipo = ""; filtros.tipoCliente = ""; filtros.etapa = ""; filtros.rep = "";
    filtros.canal = ""; filtros.modalidad = "";
    $("ag-f-tipo").value = ""; $("ag-f-etapa").value = ""; $("ag-f-rep").value = "";
    $("ag-f-canal").value = ""; $("ag-f-modalidad").value = "";
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
// 🔁 COMPARAR MESES
// ═══════════════════════════════════════════
function statsMes(clave) {
  const del = baseGestiones().filter(g => mesDe(g) === clave);
  return {
    total: del.length,
    comerciales: del.filter(g => g.tipo === "Comercial").length,
    operativas: del.filter(g => g.tipo === "Operativo").length,
    cuentas: new Set(del.map(g => String(g.cuenta || "").trim()).filter(Boolean)).size,
    nuevos: del.filter(g => g.tipoCliente === "Nuevo").length,
    presenciales: del.filter(g => g.modalidad === "Presencial").length,
    porRep: del.reduce((acc, g) => { const r = g.rep || "Sin rep"; acc[r] = (acc[r] || 0) + 1; return acc; }, {})
  };
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
    ${fila("Gestiones totales", A.total, B.total)}
    ${fila("Comerciales", A.comerciales, B.comerciales)}
    ${fila("Operativas", A.operativas, B.operativas)}
    ${fila("Cuentas únicas", A.cuentas, B.cuentas)}
    ${fila("Clientes nuevos", A.nuevos, B.nuevos)}
    ${fila("Presenciales", A.presenciales, B.presenciales)}
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
  $("ag-c-ciudad").value = g?.ciudad || "";
  const hoy = new Date();
  $("ag-c-fecha").value = g?.fecha || claveFecha(hoy);
  $("ag-c-hora").value = g?.hora || `${pad(hoy.getHours())}:${pad(hoy.getMinutes())}`;
  $("ag-c-cuenta").value = g?.cuenta || "";
  $("ag-c-oportunidad").value = g?.oportunidad || "";
  $("ag-c-tipoCliente").value = g?.tipoCliente || "";
  $("ag-c-canal").value = g?.canal || "";
  $("ag-c-modalidad").value = g?.modalidad || "";
  $("ag-c-tipo").value = g?.tipo || "";
  const esComercial = (g?.tipo === "Comercial");
  $("ag-etapa-wrap").style.display = esComercial ? "flex" : "none";
  $("ag-c-etapa").value = esComercial ? etapaDe(g) : "";
  $("ag-c-notas").value = g?.notas || "";
  $("ag-btn-eliminar").style.display = (g && esAdmin()) ? "inline-block" : "none";

  // Trazabilidad
  $("ag-link-wrap").style.display = esComercial ? "block" : "none";
  poblarSelectDeals();
  $("ag-c-deal").value = (g?.dealId && deals.some(d => d.id === g.dealId)) ? g.dealId : "";
  alCambiarDeal();

  $("ag-modal").classList.add("open");
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
  const ciudad = $("ag-c-ciudad").value.trim();
  const fecha = $("ag-c-fecha").value;
  const cuenta = $("ag-c-cuenta").value.trim();
  const oportunidad = $("ag-c-oportunidad").value.trim();
  const tipoCliente = $("ag-c-tipoCliente").value;
  const canal = $("ag-c-canal").value;
  const modalidad = $("ag-c-modalidad").value;
  const tipo = $("ag-c-tipo").value;
  const etapa = $("ag-c-etapa").value;

  if (!rep || !ciudad || !fecha || !cuenta || !oportunidad || !tipoCliente || !canal || !modalidad || !tipo) {
    err.textContent = "Completa todos los campos obligatorios (*).";
    return;
  }
  if (tipo === "Comercial" && !etapa) {
    err.textContent = "Selecciona la etapa comercial.";
    return;
  }

  // ── Trazabilidad con el pipeline ──
  const vinculo = tipo === "Comercial" ? $("ag-c-deal").value : "";
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
      const resDeal = await crearDeal({
        oportunidad, cuenta, rep, estado, valor,
        prob: 0.5, esperado: Math.round(valor * 0.5),
        canal: "", origen: "Agenda Comercial", comentarios: "Creada desde una gestión de la agenda"
      });
      if (!resDeal.ok) {
        err.textContent = "No se pudo crear la oportunidad: " + resDeal.error;
        btn.disabled = false; btn.textContent = "💾 Guardar gestión";
        return;
      }
      dealId = resDeal.id;
    } else if (vinculo) {
      // Actualizar la oportunidad existente: estado + valor
      // (la cuenta NO se toca: se mantiene la del pipeline)
      const valor = parseFloat($("ag-c-deal-valor").value);
      const estado = $("ag-c-deal-estado").value;
      const cambios = {};
      if (estado) cambios.estado = estado;
      if (!isNaN(valor)) cambios.valor = valor;
      const dealActual = deals.find(d => d.id === vinculo);
      if (!isNaN(valor) && dealActual) {
        const p = parseFloat(dealActual.prob) || 0;
        cambios.esperado = Math.round(valor * p);
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

    // ── Guardar la gestión (con la referencia a la oportunidad) ──
    const datos = {
      rep, ciudad, fecha, cuenta, oportunidad, tipoCliente, canal, modalidad, tipo,
      hora: $("ag-c-hora").value,
      etapa: tipo === "Comercial" ? etapa : "",
      etapaVenta: tipo === "Comercial" ? etapa : "",
      notas: $("ag-c-notas").value.trim(),
      dealId: dealId,
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
