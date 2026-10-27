// ═══════════════════════════════════════════════════════════
// sprint-detalle.js — v1 (oct 2026)
// Panel lateral "Gestiones" de la pestaña Sprint.
// Al hacer clic en una tarjeta, una fila del embudo, del tablero
// de métricas, de la tabla por representante o en el nombre de una
// cuenta, se abre este panel con las gestiones que forman ese número.
//
// No consulta Firestore: recibe la lista ya filtrada desde
// sprint-view.js. El botón ✏️ pide a app.js abrir la gestión en la
// Agenda (evento "sprint:abrir-gestion").
// ═══════════════════════════════════════════════════════════

import { esAdmin, obtenerUsuario } from "./auth-service.js";
import { ACCIONES_SPRINT } from "./sprint-config.js";

const $ = (id) => document.getElementById(id);
let actual = { titulo: "", sub: "", lista: [] };
let texto = "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtD = (s) => {
  if (!s) return "—";
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
};
function puedeEditar(g) {
  const u = obtenerUsuario();
  return esAdmin() || (u?.nombreRep && u.nombreRep === g.rep);
}

export function montarDetalle(contenedor) {
  contenedor.innerHTML = `
    <style>
      .sp-clic{cursor:pointer;transition:box-shadow .15s,background .15s}
      .m-card.sp-clic:hover{box-shadow:0 0 0 2px var(--blue)}
      .sp-frow.sp-clic:hover span:first-child{color:var(--blue);text-decoration:underline}
      tr.sp-clic:hover td{background:var(--blue-l)}
      td.sp-clic:hover{background:var(--blue-l);color:#1d4ed8;font-weight:600}
      .sp-link{cursor:pointer;border-bottom:1px dashed var(--txt3)}
      .sp-link:hover{color:var(--blue);border-bottom-color:var(--blue)}
      .sp-dr-ov{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:600;display:none}
      .sp-dr-ov.open{display:block}
      .sp-dr{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--surface);box-shadow:-12px 0 40px rgba(0,0,0,.25);display:flex;flex-direction:column}
      .sp-dr-hdr{padding:16px 18px 12px;border-bottom:.5px solid var(--border);display:flex;gap:10px;align-items:flex-start}
      .sp-dr-hdr h3{font-size:16px;font-weight:700}
      .sp-dr-hdr .sub{font-size:12px;color:var(--txt3);margin-top:3px}
      .sp-dr-body{padding:12px 18px 24px;overflow-y:auto;flex:1}
      .sp-dr-item{display:grid;grid-template-columns:86px 1fr auto;gap:10px;padding:10px 0;border-bottom:.5px solid var(--border);align-items:start}
      .sp-dr-item:last-child{border-bottom:none}
      .sp-dr-fecha{font-size:12px;color:var(--txt2);font-weight:600}
      .sp-dr-cta{font-weight:700;font-size:13px}
      .sp-dr-meta{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
      .sp-dr-chip{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--s2);color:var(--txt2)}
      .sp-dr-chip.s{background:var(--amber-l);color:#92400e}.sp-dr-chip.d{background:var(--green-l);color:#15803d}
      .sp-dr-notas{font-size:12px;color:var(--txt2);margin-top:5px;white-space:pre-wrap}
      @media(max-width:560px){.sp-dr-item{grid-template-columns:1fr auto}.sp-dr-fecha{grid-column:1/-1}}
    </style>
    <div class="sp-dr-ov" id="sp-dr-ov">
      <aside class="sp-dr" role="dialog" aria-modal="true" aria-labelledby="sp-dr-titulo">
        <div class="sp-dr-hdr">
          <div style="flex:1"><h3 id="sp-dr-titulo">Gestiones</h3><div class="sub" id="sp-dr-sub"></div></div>
          <button class="modal-close" id="sp-dr-cerrar" aria-label="Cerrar">×</button>
        </div>
        <div style="padding:10px 18px 0"><input class="filtro-input" id="sp-dr-buscar" style="width:100%" placeholder="🔍 Buscar cuenta, rep o nota…"/></div>
        <div class="sp-dr-body" id="sp-dr-lista"></div>
      </aside>
    </div>`;
  $("sp-dr-cerrar").addEventListener("click", cerrarDetalle);
  $("sp-dr-ov").addEventListener("click", (e) => { if (e.target.id === "sp-dr-ov") cerrarDetalle(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("sp-dr-ov")?.classList.contains("open")) cerrarDetalle(); });
  $("sp-dr-buscar").addEventListener("input", (e) => { texto = e.target.value; pintar(); });
}

// titulo: texto del panel · sub: aclaración (periodo, rep) · lista: gestiones
export function abrirDetalle({ titulo, sub = "", lista = [] }) {
  if (!$("sp-dr-ov")) return;
  actual = { titulo, sub, lista: [...lista].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.hora || "").localeCompare(String(a.hora || ""))) };
  texto = ""; $("sp-dr-buscar").value = "";
  pintar();
  $("sp-dr-ov").classList.add("open");
}

export function cerrarDetalle() { $("sp-dr-ov")?.classList.remove("open"); }

function pintar() {
  const q = norm(texto);
  const lista = actual.lista.filter(g => !q || norm([g.cuenta, g.rep, g.notas, g.oportunidad, g.sprintPaso].join(" ")).includes(q));
  $("sp-dr-titulo").textContent = actual.titulo;
  $("sp-dr-sub").textContent = `${lista.length} ${lista.length === 1 ? "gestión" : "gestiones"}${actual.sub ? " · " + actual.sub : ""}`;
  if (!lista.length) {
    $("sp-dr-lista").innerHTML = `<div class="lista-vacia">${actual.lista.length ? "Ninguna gestión coincide con la búsqueda." : "Todavía no hay gestiones registradas para este indicador."}</div>`;
    return;
  }
  $("sp-dr-lista").innerHTML = lista.map(g => {
    const acc = ACCIONES_SPRINT[g.sprintAccion];
    const chips = [
      acc ? `<span class="sp-dr-chip s">🚀 ${esc(g.sprintAccion === "ruta" ? (g.sprintPaso || acc.corto) : acc.corto)}</span>` : "",
      g.sprintDecisor ? `<span class="sp-dr-chip d">Con decisor</span>` : "",
      g.tipo ? `<span class="sp-dr-chip">${esc(g.tipo)}${g.etapaVenta || g.etapa ? " · " + esc(g.etapaVenta || g.etapa) : ""}</span>` : "",
      g.modalidad ? `<span class="sp-dr-chip">${esc(g.modalidad)}</span>` : "",
      g.dealId ? `<span class="sp-dr-chip">🔗 Pipeline</span>` : ""
    ].join("");
    return `<div class="sp-dr-item">
      <div class="sp-dr-fecha">${fmtD(g.fecha)}${g.hora ? `<br><span style="font-weight:400">${esc(g.hora)}</span>` : ""}</div>
      <div><div class="sp-dr-cta">${esc(g.cuenta) || "(sin cuenta)"}</div>
        <div style="font-size:12px;color:var(--txt3)">${esc(g.rep)}${g.oportunidad ? " · " + esc(g.oportunidad) : ""}${g.ciudad ? " · 📍 " + esc(g.ciudad) : ""}</div>
        <div class="sp-dr-meta">${chips}</div>
        ${g.notas ? `<div class="sp-dr-notas">${esc(g.notas)}</div>` : ""}</div>
      <div>${puedeEditar(g) ? `<button class="btn-editar" data-gid="${esc(g.id)}" title="Abrir en la Agenda" aria-label="Abrir en la Agenda">✏️</button>` : ""}</div>
    </div>`;
  }).join("");
  $("sp-dr-lista").querySelectorAll("[data-gid]").forEach(b => b.addEventListener("click", () => {
    cerrarDetalle();
    document.dispatchEvent(new CustomEvent("sprint:abrir-gestion", { detail: { id: b.dataset.gid } }));
  }));
}
