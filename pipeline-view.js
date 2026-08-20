// ═══════════════════════════════════════════════════════════
// pipeline-view.js — v3
// Vista del Pipeline con dos sub-pestañas:
//   📈 Dashboard      → forecast vs cuota, embudo, pipeline por
//                       mes y avance de cuota por rep (gráficas)
//   📋 Oportunidades  → filtros completos + tabla + formulario
//
// Gerencia ve el dashboard del equipo completo; un vendedor ve
// su propio dashboard (solo sus oportunidades y su cuota).
// ═══════════════════════════════════════════════════════════

import { obtenerUsuario, esAdmin } from "./auth-service.js";
import { suscribirDeals, crearDeal, actualizarDeal, eliminarDeal, suscribirCuotas, guardarCuotas } from "./firestore-service.js";

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

// ── Constantes de negocio (mismas del Pipeline viejo) ──
const ESTADOS = ["Identificado", "Cotizado", "En diseño", "Negociación", "On hold", "Ganado", "Perdido"];
const ESTADOS_ACTIVOS = new Set(["Identificado", "Cotizado", "En diseño", "Negociación", "On hold"]);
const ORDEN_EMBUDO = ["Identificado", "Cotizado", "En diseño", "Negociación", "On hold"];
const COLORES_EMBUDO = ["#6d28d9", "#1d4ed8", "#0f766e", "#15803d", "#b45309"];
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
let editandoId = null;
let ordenCampo = "valor", ordenDir = -1;
let charts = {};
// Filtros de MULTISELECCIÓN: cada uno es un conjunto de valores marcados
// (vacío = "Todos"). El texto de búsqueda sigue siendo libre.
const filtros = {
  texto: "",
  rep: new Set(), estado: new Set(), tipo: new Set(), canal: new Set(),
  segmento: new Set(), origen: new Set(), riesgo: new Set(), mes: new Set(), anio: new Set()
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
// Valor esperado de un deal (usa el guardado o lo calcula)
function esperadoDe(d) {
  const v = parseFloat(d.valor) || 0, p = parseFloat(d.prob) || 0;
  return (d.esperado != null && !isNaN(parseFloat(d.esperado))) ? parseFloat(d.esperado) : Math.round(v * p);
}
// ¿El registro cuenta para el año de cuota? (regla del Pipeline viejo:
// sin año se asume del año en curso; otro año queda excluido)
// Clasifica la oportunidad como Retail o Corporativo leyendo
// TANTO el campo canal como el campo segmento (el histórico
// guarda este dato en cualquiera de los dos, con mayúsculas variadas).
function segmentoDe(d) {
  const c = String(d.canal || "").trim().toLowerCase();
  const s = String(d.segmento || "").trim().toLowerCase();
  if (c === "retail" || s === "retail") return "Retail";
  if (c === "corporativo" || s === "corporativo") return "Corporativo";
  return "";
}
function anioDe(d) {
  // Extrae el año sin importar el formato: 2026, "2026", "2026 ", "2.026"...
  const s = String(d.anio_radicacion ?? "").trim();
  if (!s) return null; // sin año registrado
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}
function esDelAnio(d) {
  const a = anioDe(d);
  // Sin año se asume del año en curso (regla del Pipeline original)
  return a === null || a === ANIO_CUOTA;
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
  MS_DEFS.forEach(def => filtros[def.clave].clear());
  ordenCampo = "valor"; ordenDir = -1;
  pintarEstructura();
  if (parar) parar();
  parar = suscribirDeals(
    (lista) => { deals = lista; actualizarOpcionesFiltros(); render(); },
    () => {
      $("pl-sub-dash").innerHTML =
        `<div class="estado-conexion error">✕ No se pudo conectar al Pipeline. Revisa tu conexión o tus permisos.</div>`;
    }
  );
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
  set("lbl-dona", `Forecast vs cuota ${ANIO_CUOTA}`);
  set("lbl-gvp", `Ganado vs Perdido por mes (${ANIO_CUOTA})`);
  set("lbl-cuotas", `Avance de cuota por rep (Ganado ${ANIO_CUOTA})`);
}

export function detenerPipeline() {
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
  { id: "ms-tipo",   clave: "tipo",   etiqueta: "Tipo",     opciones: () => valoresUnicos("tipo") },
  { id: "ms-canal",  clave: "canal",  etiqueta: "Canal",    opciones: () => {
      const ops = valoresUnicos("canal");
      if (baseDeals().some(d => !String(d.canal || "").trim())) ops.push("Sin canal");
      return ops;
    } },
  { id: "ms-seg",    clave: "segmento", etiqueta: "Segmento", opciones: () => {
      const s = new Set(baseDeals().map(segmentoDe));
      const ops = [...s].filter(Boolean).sort();
      if (s.has("")) ops.push("Sin segmento");
      return ops;
    } },
  { id: "ms-origen", clave: "origen", etiqueta: "Origen",   opciones: () => {
      const ops = valoresUnicos("origen");
      if (baseDeals().some(d => !String(d.origen || "").trim())) ops.push("Sin origen");
      return ops;
    } },
  { id: "ms-riesgo", clave: "riesgo", etiqueta: "Riesgo",   opciones: () => valoresUnicos("riesgo") },
  { id: "ms-mes",    clave: "mes",    etiqueta: "Mes rad.", opciones: () => MESES.filter(m => valoresUnicos("mes_radicacion").includes(m)) },
  { id: "ms-anio",   clave: "anio",   etiqueta: "Año rad.", opciones: () => [...new Set(baseDeals().map(anioDe).filter(a => a !== null))].sort((a, b) => b - a).map(String) }
];
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
    const panel = cont.querySelector(".ms-panel");
    panel.innerHTML = ops.length
      ? ops.map((v, i) => `<label class="ms-opt"><input type="checkbox" data-i="${i}" ${set.has(v) ? "checked" : ""}/> ${esc(v)}</label>`).join("")
      : `<div class="ms-opt" style="color:var(--txt3)">Sin valores</div>`;
    panel.querySelectorAll("input").forEach(chk => {
      chk.addEventListener("change", () => {
        const v = ops[parseInt(chk.dataset.i)];
        if (chk.checked) set.add(v); else set.delete(v);
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

// ═══════════════════════════════════════════
// ESTRUCTURA BASE
// ═══════════════════════════════════════════
function pintarEstructura() {
  const u = obtenerUsuario();
  $("page-pipeline").innerHTML = `
    <style>
      .pl-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
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
    </style>

    <div class="page-hdr">
      <div>
        <div class="page-title">Pipeline</div>
        <div class="page-sub">${esAdmin() ? "Oportunidades comerciales del equipo" : "Mi pipeline — " + esc(u.nombreRep)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${esAdmin() ? `<button class="btn-secundario" id="pl-btn-cuotas">⚙️ Cuotas</button>` : ""}
        <button class="btn-primario" id="pl-btn-nueva">＋ Nueva oportunidad</button>
      </div>
    </div>

    <div class="pl-subtabs">
      <button class="pl-subtab active" id="pl-st-dash">📈 Dashboard</button>
      <button class="pl-subtab" id="pl-st-tabla">📋 Oportunidades</button>
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
        <div class="ms" id="ms-anio"><button type="button" class="ms-btn">Año rad.: Todos</button><div class="ms-panel"></div></div>
        <button class="btn-secundario" id="pl-f-limpiar" style="padding:7px 12px;font-size:12px">✕ Limpiar</button>
        <span class="filtro-conteo" id="pl-conteo"></span>
      </div>

    <!-- ═══ SUB-VISTA: DASHBOARD ═══ -->
    <div id="pl-sub-dash">
      <div class="m-grid" id="dash-cards"></div>
      <p class="hint">💡 Haz clic en las tarjetas, el embudo, los motivos o las barras de cuota para ver esas oportunidades.</p>
      <div id="dash-salud" style="display:none;cursor:pointer;margin-bottom:16px;background:var(--amber-l);color:#92400e;border-radius:var(--r);padding:12px 16px;font-size:13px;font-weight:500"></div>
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl" id="lbl-dona">Forecast vs cuota ${ANIO_CUOTA}</p>
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
      <div class="pl-g2" style="margin-bottom:16px">
        <div class="card" style="margin-bottom:0">
          <p class="section-lbl" id="lbl-gvp">Ganado vs Perdido por mes (${ANIO_CUOTA})</p>
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
          <p class="section-lbl">Origen de las oportunidades (CRM, Broker...)</p>
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
        <p class="section-lbl" id="lbl-cuotas">Avance de cuota por rep (Ganado ${ANIO_CUOTA})</p>
        <div id="dash-cuotas"></div>
      </div>
    </div>

    <!-- ═══ SUB-VISTA: OPORTUNIDADES (tabla) ═══ -->
    <div id="pl-sub-tabla" style="display:none">
      <div class="m-grid" id="pl-metricas"></div>

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
            <div class="form-group full"><label class="form-label">Cuenta / Cliente *</label>
              <input class="form-input" id="pl-c-cuenta" placeholder="Nombre del cliente"/></div>
            <div class="form-group"><label class="form-label">Rep *</label>
              <select class="form-select" id="pl-c-rep"></select></div>
            <div class="form-group"><label class="form-label">Estado *</label>
              <select class="form-select" id="pl-c-estado">
                <option value="">Seleccionar...</option>
                ${ESTADOS.map(e => `<option>${e}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Valor (COP) *</label>
              <input class="form-input" id="pl-c-valor" type="number" min="0" placeholder="0"/></div>
            <div class="form-group"><label class="form-label">Probabilidad (%)</label>
              <input class="form-input" id="pl-c-prob" type="number" min="0" max="100" placeholder="50"/></div>
            <div class="form-group"><label class="form-label">Tipo</label>
              <input class="form-input" id="pl-c-tipo" list="pl-dl-tipo"/>
              <datalist id="pl-dl-tipo"></datalist></div>
            <div class="form-group"><label class="form-label">Canal</label>
              <input class="form-input" id="pl-c-canal" list="pl-dl-canal"/>
              <datalist id="pl-dl-canal"></datalist></div>
            <div class="form-group"><label class="form-label">Origen</label>
              <input class="form-input" id="pl-c-origen" list="pl-dl-origen"/>
              <datalist id="pl-dl-origen"></datalist></div>
            <div class="form-group"><label class="form-label">Riesgo</label>
              <select class="form-select" id="pl-c-riesgo">
                <option value="">—</option>
                ${RIESGOS.map(r => `<option>${r}</option>`).join("")}
              </select></div>
            <div class="form-group"><label class="form-label">Segmento</label>
              <input class="form-input" id="pl-c-segmento" list="pl-dl-segmento"/>
              <datalist id="pl-dl-segmento"></datalist></div>
            <div class="form-group"><label class="form-label">Broker</label>
              <input class="form-input" id="pl-c-broker" list="pl-dl-broker"/>
              <datalist id="pl-dl-broker"></datalist></div>
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
              <input class="form-input" id="pl-c-anio" type="number" placeholder="${ANIO_CUOTA}"/></div>
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
  `;

  // Sub-pestañas
  $("pl-st-dash").addEventListener("click", () => mostrarSub("dash"));
  $("pl-st-tabla").addEventListener("click", () => mostrarSub("tabla"));

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

  // Eventos de filtros
  $("pl-f-texto").addEventListener("input", (e) => { filtros.texto = e.target.value.toLowerCase(); render(); });
  iniciarMultiselects();
  $("pl-f-limpiar").addEventListener("click", () => {
    filtros.texto = "";
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
  $("pl-sub-dash").style.display = nombre === "dash" ? "block" : "none";
  $("pl-sub-tabla").style.display = nombre === "tabla" ? "block" : "none";
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

  const dl = (id, campo) => { const el = $(id); if (el) el.innerHTML = valoresUnicos(campo).map(v => `<option value="${esc(v)}">`).join(""); };
  dl("pl-dl-tipo", "tipo"); dl("pl-dl-canal", "canal"); dl("pl-dl-origen", "origen");
  dl("pl-dl-segmento", "segmento"); dl("pl-dl-broker", "broker");
}

// ═══════════════════════════════════════════
// RENDER GENERAL
// ═══════════════════════════════════════════
function render() {
  renderDashboard();
  renderTabla();
}

// Salta a la pestaña Oportunidades con un filtro aplicado
function irATablaFiltrada(estado, rep) {
  filtros.estado = new Set(estado ? [estado] : []);
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
    if (k === "prob_pct") return Math.round((parseFloat(d.prob) || 0) * 100);
    if (k === "anio_radicacion") return anioDe(d) ?? "";
    return d[k] ?? "";
  }).map(celda).join(";"));
  const csv = "\ufeff" + [cols.join(";"), ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pipeline_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`⬇ CSV exportado: ${filas.length} oportunidades`);
}

// ═══════════════════════════════════════════
// DASHBOARD (gráficas)
// ═══════════════════════════════════════════
function renderDashboard() {
  const u = obtenerUsuario();
  // Universo del dashboard: rol + filtros globales aplicados
  const propios = filtrarDeals();
  const delAnio = propios.filter(esDelAnio);

  const activos = delAnio.filter(d => ESTADOS_ACTIVOS.has(d.estado));
  const ganados = delAnio.filter(d => d.estado === "Ganado");
  const perdidos = delAnio.filter(d => d.estado === "Perdido");
  const vActivo = activos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vGanado = ganados.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vPerdido = perdidos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const vEsp = activos.reduce((s, d) => s + esperadoDe(d), 0);


  const repsFiltrados = [...filtros.rep];
  const cuota = !esAdmin()
    ? (CUOTAS[u.nombreRep] || 0)
    : (repsFiltrados.length
        ? repsFiltrados.reduce((s, n) => s + (CUOTAS[n] || 0), 0)
        : Object.values(CUOTAS).reduce((s, c) => s + c, 0));
  const fPct = cuota > 0 ? Math.round((vGanado + vEsp) / cuota * 100) : 0;
  const colorF = fPct >= 100 ? "#16a34a" : fPct >= 80 ? "#d97706" : "#dc2626";

  // 🩺 Salud de datos (solo Gerencia): huecos del histórico
  const salud = $("dash-salud");
  if (salud) {
    const noPerdidas = baseDeals().filter(d => d.estado !== "Perdido");
    const sinMes = noPerdidas.filter(d => !MESES.includes(String(d.mes_radicacion || "").toLowerCase())).length;
    const sinProb = baseDeals().filter(d => ESTADOS_ACTIVOS.has(d.estado) && !(parseFloat(d.prob) > 0)).length;
    if (!esAdmin() || sinMes + sinProb === 0) {
      salud.style.display = "none";
    } else {
      salud.style.display = "block";
      salud.innerHTML = `🩺 Calidad de datos: <b>${sinMes}</b> oportunidades sin mes de radicación · <b>${sinProb}</b> activas sin probabilidad — clic para revisarlas`;
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
    <div class="m-card"><div class="m-lbl">Cuota ${ANIO_CUOTA}</div>
      <div class="m-val">${fmt(cuota)}</div>
      <div class="m-sub">${!esAdmin() ? "mi cuota" : (repsFiltrados.length === 1 ? "cuota de " + esc(repsFiltrados[0]) : repsFiltrados.length > 1 ? "cuota de " + repsFiltrados.length + " reps" : "equipo completo")}</div></div>
    <div class="m-card clic" id="dc-ganado"><div class="m-lbl">Ganado ${ANIO_CUOTA}</div>
      <div class="m-val" style="color:var(--green)">${fmt(vGanado)}</div>
      <div class="m-sub">${ganados.length} oportunidades · clic para ver</div></div>
    <div class="m-card clic" id="dc-activo"><div class="m-lbl">Pipeline activo</div>
      <div class="m-val" style="color:var(--blue)">${fmt(vActivo)}</div>
      <div class="m-sub">esperado: ${fmt(vEsp)}</div></div>
    <div class="m-card"><div class="m-lbl">Forecast</div>
      <div class="m-val" style="color:${colorF}">${fPct}%</div>
      <div class="m-sub">(ganado + esperado) / cuota</div></div>
    <div class="m-card clic" id="dc-perdido"><div class="m-lbl">Perdido ${ANIO_CUOTA}</div>
      <div class="m-val" style="color:var(--red)">${fmt(vPerdido)}</div>
      <div class="m-sub">${perdidos.length} oportunidades · clic para ver</div></div>
  `;
  $("dc-ganado").addEventListener("click", () => irATablaFiltrada("Ganado"));
  $("dc-perdido").addEventListener("click", () => irATablaFiltrada("Perdido"));
  $("dc-activo").addEventListener("click", () => irATablaFiltrada(""));

  // Dona de forecast
  mkChart("ch-forecast", {
    type: "doughnut",
    data: { datasets: [{
      data: [Math.min(fPct, 100), Math.max(100 - fPct, 0)],
      backgroundColor: [colorF, "#f0efe9"],
      borderWidth: 0
    }]},
    options: {
      cutout: "72%", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, tooltip: { enabled: false },
        title: {
          display: true,
          text: [`${fPct}% del forecast`, `Ganado ${fmt(vGanado)} + Esp. ${fmt(vEsp)}`, `Cuota: ${fmt(cuota)}`],
          font: { size: 12 }, color: "#1a1a18"
        }
      }
    }
  });

  // Embudo por estado
  const maxV = Math.max(...ORDEN_EMBUDO.map(e =>
    activos.filter(d => d.estado === e).reduce((s, d) => s + (parseFloat(d.valor) || 0), 0)), 1);
  $("dash-funnel").innerHTML = ORDEN_EMBUDO.map((e, i) => {
    const sub = activos.filter(d => d.estado === e);
    const v = sub.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
    const w = Math.round(v / maxV * 100);
    return `<div class="funnel-row clic" data-estado="${e}">
      <span class="funnel-lbl">${e}</span>
      <div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(w, 8)}%;background:${COLORES_EMBUDO[i]}">${fmt(v)}</div></div>
      <span class="funnel-n">${sub.length} ops</span>
    </div>`;
  }).join("");
  $("dash-funnel").querySelectorAll(".funnel-row").forEach(row => {
    row.addEventListener("click", () => irATablaFiltrada(row.dataset.estado));
  });

  // Pipeline por mes de radicación
  // Forecast de radicación mensual:
  //   Ganado → cuenta al 100% de su valor en su mes de radicación
  //   Activo → cuenta su valor esperado (valor × probabilidad)
  //   Perdido → no cuenta
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

  // Avance de cuota por rep (Gerencia ve a todos; un vendedor su barra)
  let nombres;
  if (!esAdmin()) nombres = CUOTAS[u.nombreRep] ? [u.nombreRep] : [];
  else if (repsFiltrados.length) nombres = repsFiltrados.filter(n => CUOTAS[n] !== undefined);
  else nombres = Object.keys(CUOTAS);
  $("dash-cuotas").innerHTML = nombres.map(nombre => {
    const cuotaRep = CUOTAS[nombre];
    const cumplido = propios
      .filter(d => d.rep === nombre && d.estado === "Ganado" && esDelAnio(d))
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
  }).join("") || `<div class="lista-vacia">Sin cuota asignada</div>`;
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

  // ── Segmento: Retail vs Corporativo (campo segmento, tolera que venga en canal) ──
  const bucketsSeg = {};
  propios.forEach(d => {
    const clave = segmentoDe(d) || "Sin segmento";
    const b = bucketsSeg[clave] = bucketsSeg[clave] || { n: 0, v: 0 };
    b.n++; b.v += parseFloat(d.valor) || 0;
  });
  const segLabels = Object.keys(bucketsSeg).sort((a, b) => bucketsSeg[b].v - bucketsSeg[a].v);
  const SEG_COLORS = { "Retail": "#d97706", "Corporativo": "#2563EB", "Sin segmento": "#9b9b96" };
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
  propios.forEach(d => {
    const crudo = String(d.canal || "").trim();
    const clave = crudo || "Sin canal";
    const b = bucketsCanal[clave] = bucketsCanal[clave] || { n: 0, v: 0, crudos: new Set() };
    b.n++; b.v += parseFloat(d.valor) || 0;
    if (crudo) b.crudos.add(crudo);
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
        filtros.canal = k === "Sin canal" ? new Set(["Sin canal"]) : new Set([...bucketsCanal[k].crudos]);
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
  const bucketsOrigen = {};
  propios.forEach(d => {
    const crudo = String(d.origen || "").trim();
    const clave = crudo || "Sin origen";
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
        const k = origenLabels[elems[0].index];
        filtros.origen = new Set([k]);
        actualizarMultiselects(); render(); mostrarSub("tabla");
      },
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c2) => `${c2.label}: ${fmtFull(c2.raw)} · ${bucketsOrigen[c2.label].n} ops` } }
      }
    }
  });
  $("sum-origen").innerHTML = origenLabels.map(k =>
    `<b>${esc(k)}</b>: ${bucketsOrigen[k].n} ops · ${fmt(bucketsOrigen[k].v)}`).join(" &nbsp;·&nbsp; ");

  // ── Top brokers por valor (con clic para ver sus oportunidades) ──
  const brokers = {};
  propios.forEach(d => {
    const nom = String(d.broker || "").trim();
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
    if (filtros.rep.size && !filtros.rep.has(d.rep)) return false;
    if (filtros.estado.size && !filtros.estado.has(d.estado)) return false;
    if (filtros.tipo.size && !filtros.tipo.has(String(d.tipo || "").trim())) return false;
    if (filtros.canal.size && !filtros.canal.has(String(d.canal || "").trim() || "Sin canal")) return false;
    if (filtros.segmento.size && !filtros.segmento.has(segmentoDe(d) || "Sin segmento")) return false;
    if (filtros.origen.size && !filtros.origen.has(String(d.origen || "").trim() || "Sin origen")) return false;
    if (filtros.riesgo.size && !filtros.riesgo.has(String(d.riesgo || "").trim())) return false;
    if (filtros.mes.size && !filtros.mes.has(d.mes_radicacion)) return false;
    if (filtros.anio.size && !filtros.anio.has(String(anioDe(d) ?? ""))) return false;
    if (filtros.texto) {
      const blob = ((d.oportunidad || "") + " " + (d.cuenta || "") + " " + (d.broker || "")).toLowerCase();
      if (!blob.includes(filtros.texto)) return false;
    }
    return true;
  });
}

function renderTabla() {
  const visibles = filtrarDeals();

  const activos = visibles.filter(d => ESTADOS_ACTIVOS.has(d.estado));
  const ganados = visibles.filter(d => d.estado === "Ganado");
  const valorActivo = activos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const valorGanado = ganados.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const espActivo = activos.reduce((s, d) => s + esperadoDe(d), 0);
  $("pl-metricas").innerHTML = `
    <div class="m-card"><div class="m-lbl">Pipeline activo</div>
      <div class="m-val" style="color:var(--blue)">${fmt(valorActivo)}</div>
      <div class="m-sub">${activos.length} oportunidades</div></div>
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
      const p = parseFloat(d.prob) || 0;
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
        <td>${esc(d.mes_radicacion) || "—"}${anioDe(d) !== null ? " · " + anioDe(d) : ""}</td>
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

// ═══════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════
function abrirModal(deal) {
  editandoId = deal ? deal.id : null;
  $("pl-modal-titulo").textContent = deal ? "Editar oportunidad" : "Nueva oportunidad";
  $("pl-modal-error").textContent = "";
  $("pl-c-oportunidad").value = deal?.oportunidad || "";
  $("pl-c-cuenta").value = deal?.cuenta || "";
  if (esAdmin()) $("pl-c-rep").value = deal?.rep || "";
  $("pl-c-estado").value = deal?.estado || "";
  $("pl-c-valor").value = deal?.valor ?? "";
  const prob = parseFloat(deal?.prob);
  $("pl-c-prob").value = isNaN(prob) ? "" : Math.round(prob * 100);
  $("pl-c-tipo").value = deal?.tipo || "";
  $("pl-c-canal").value = deal?.canal || "";
  $("pl-c-origen").value = deal?.origen || "";
  $("pl-c-riesgo").value = deal?.riesgo || "";
  $("pl-c-segmento").value = deal?.segmento || "";
  $("pl-c-broker").value = deal?.broker || "";
  $("pl-c-mes-inicio").value = deal?.mes_inicio || "";
  $("pl-c-mes").value = deal?.mes_radicacion || "";
  $("pl-c-anio").value = deal?.anio_radicacion || "";
  $("pl-c-motivo").value = deal?.motivo_perdida || "";
  $("pl-c-comentarios").value = deal?.comentarios || "";
  $("pl-btn-eliminar").style.display = (deal && esAdmin()) ? "inline-block" : "none";
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
  const cuenta = $("pl-c-cuenta").value.trim();
  const rep = esAdmin() ? $("pl-c-rep").value : u.nombreRep;
  const estado = $("pl-c-estado").value;
  const valor = parseFloat($("pl-c-valor").value);

  if (!oportunidad || !cuenta || !rep || !estado || isNaN(valor)) {
    err.textContent = "Completa los campos obligatorios (*).";
    return;
  }

  const probPct = parseFloat($("pl-c-prob").value);
  const prob = isNaN(probPct) ? 0 : Math.min(Math.max(probPct, 0), 100) / 100;
  const datos = {
    oportunidad, cuenta, rep, estado,
    valor,
    prob,
    esperado: Math.round(valor * prob),
    tipo: $("pl-c-tipo").value.trim(),
    canal: $("pl-c-canal").value.trim(),
    origen: $("pl-c-origen").value.trim(),
    riesgo: $("pl-c-riesgo").value,
    segmento: $("pl-c-segmento").value.trim(),
    broker: $("pl-c-broker").value.trim(),
    mes_inicio: $("pl-c-mes-inicio").value,
    mes_radicacion: $("pl-c-mes").value,
    anio_radicacion: $("pl-c-anio").value ? parseInt($("pl-c-anio").value) : null,
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
    toast(eraEdicion ? "✓ Oportunidad actualizada" : "✓ Oportunidad creada");
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
