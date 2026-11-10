// ═══════════════════════════════════════════════════════════
// brokers-view.js — v1.0 (nov 2026)
// Sub-pestaña 🤝 Brokers del Pipeline: catálogo de brokers con
// lo que cada uno ha traído (activo, ganado, perdido) y su ficha.
//   · Cualquier usuario crea un broker (queda a su nombre).
//   · Solo Gerencia edita o borra (lo imponen las reglas).
// pipeline-view.js llama pintarBrokers(contenedor, opciones) en cada render.
// ═══════════════════════════════════════════════════════════

import { obtenerUsuario, esAdmin } from "./auth-service.js";
import { crearBroker, actualizarBroker, eliminarBroker } from "./firestore-service.js";
import { claveCuenta, parecidoCuentas } from "./catalogos.js";
import { brokers as listaBrokers, brokerDe } from "./cuentas-store.js";

const ACTIVOS = new Set(["Identificado", "Cotizado", "En diseño", "Negociación"]);
const EST_STYLE = {
  "Cotizado": { bg: "#EFF6FF", cl: "#1d4ed8" }, "Identificado": { bg: "#EDE9FE", cl: "#6d28d9" },
  "Negociación": { bg: "#DCFCE7", cl: "#15803d" }, "On hold": { bg: "#FEF3C7", cl: "#b45309" },
  "En diseño": { bg: "#CCFBF1", cl: "#0f766e" }, "Ganado": { bg: "#DCFCE7", cl: "#15803d" }, "Perdido": { bg: "#FEE2E2", cl: "#b91c1c" }
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}
const badge = (t, s) => { s = s || EST_STYLE[t] || { bg: "#F3F4F6", cl: "#374151" }; return `<span class="badge" style="background:${s.bg};color:${s.cl}">${esc(t)}</span>`; };
let toastTimer = null;
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

let opc = {};
let texto = "";
let abierto = "";        // clave del broker en el modal de detalle
let editando = null;     // broker en edición (null = nuevo)
let confirmar = false;

function agrupar(lista) {
  const m = new Map();
  listaBrokers().forEach(b => m.set(claveCuenta(b.nombre), { b, nombre: b.nombre, enCatalogo: true, n: 0, act: 0, gan: 0, per: 0, deals: [] }));
  lista.forEach(d => {
    const raw = String(d.broker || "").trim();
    if (!raw) return;
    const k = claveCuenta(raw);
    if (!m.has(k)) m.set(k, { b: null, nombre: raw, enCatalogo: false, n: 0, act: 0, gan: 0, per: 0, deals: [] });
    const x = m.get(k);
    const v = parseFloat(d.valor) || 0;
    x.n++; x.deals.push(d);
    if (ACTIVOS.has(d.estado)) x.act += v;
    else if (d.estado === "Ganado") x.gan += v;
    else if (d.estado === "Perdido") x.per += v;
  });
  return [...m.values()];
}

export function pintarBrokers(cont, opciones) {
  opc = opciones;
  if (!cont.dataset.listo) {
    cont.dataset.listo = "1";
    cont.innerHTML = `
      <div class="filtros-bar">
        <input class="filtro-input" id="bk-buscar" placeholder="🔍 Buscar broker, empresa o contacto…" style="flex:1;min-width:200px"/>
        <button class="btn-primario" id="bk-nuevo" style="padding:8px 14px;font-size:12px">＋ Crear broker</button>
      </div>
      <p class="hint">💡 Valores del año ${"<span id='bk-anio'></span>"} con los filtros globales. Clic en un broker para ver su ficha y todas sus oportunidades.</p>
      <div class="m-grid" id="bk-metricas"></div>
      <div class="card" style="padding:0 16px 8px"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Broker</th><th>Contacto</th><th style="text-align:right">Oportunidades</th><th style="text-align:right">Activo</th><th style="text-align:right">Ganado</th><th style="text-align:right">Perdido</th></tr></thead>
        <tbody id="bk-tbody"></tbody></table></div></div>

      <div class="modal-overlay" id="bk-det">
        <div class="modal-box" style="max-width:720px">
          <div class="modal-hdr"><span class="modal-title" id="bk-d-tit"></span><button class="modal-close" id="bk-d-x">×</button></div>
          <div class="modal-body" id="bk-d-body"></div>
        </div>
            <div class="modal-overlay" id="bk-modal">
        <div class="modal-box" style="max-width:560px">
          <div class="modal-hdr"><span class="modal-title" id="bk-m-tit">Crear broker</span><button class="modal-close" id="bk-m-x">×</button></div>
          <div class="modal-body"><div class="form-grid">
            <div class="form-group full"><label class="form-label">Nombre del broker *</label><input class="form-input" id="bk-f-nombre" maxlength="120"/></div>
            <div class="form-group"><label class="form-label">Empresa</label><input class="form-input" id="bk-f-empresa" maxlength="120"/></div>
            <div class="form-group"><label class="form-label">Persona de contacto</label><input class="form-input" id="bk-f-contacto" maxlength="120"/></div>
            <div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="bk-f-correo" type="email" maxlength="160"/></div>
            <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="bk-f-tel" type="tel" maxlength="40"/></div>
            <div class="form-group full"><label class="form-label">Notas</label><textarea class="form-input" id="bk-f-notas" rows="2" maxlength="500"></textarea></div>
          </div><div class="login-error" id="bk-f-err"></div></div>
          <div class="modal-footer">
            <button class="btn-peligro" id="bk-f-borrar" style="display:none">🗑 Eliminar</button>
            <button class="btn-secundario" id="bk-f-cancelar">Cancelar</button>
            <button class="btn-primario" id="bk-f-ok">💾 Guardar</button>
          </div>
        </div>
      </div>

</div>`;
    $("bk-buscar").addEventListener("input", (e) => { texto = e.target.value.toLowerCase(); pintarTabla(); });
    $("bk-nuevo").addEventListener("click", () => abrirForm(null));
    $("bk-m-x").addEventListener("click", cerrarForm);
    $("bk-f-cancelar").addEventListener("click", cerrarForm);
    $("bk-f-ok").addEventListener("click", guardar);
    $("bk-f-borrar").addEventListener("click", borrar);
    $("bk-f-nombre").addEventListener("input", () => { confirmar = false; $("bk-f-ok").textContent = "💾 Guardar"; $("bk-f-err").textContent = ""; });
    $("bk-d-x").addEventListener("click", () => { abierto = ""; $("bk-det").classList.remove("open"); });
  }
  $("bk-anio").textContent = opc.anio || "";
  pintarTabla();
  if (abierto) pintarDetalle();
}

function pintarTabla() {
  const grupos = agrupar(opc.deals || [])
    .filter(x => !texto || [x.nombre, x.b?.empresa, x.b?.contacto].join(" ").toLowerCase().includes(texto))
    .sort((a, b) => (b.act + b.gan) - (a.act + a.gan) || a.nombre.localeCompare(b.nombre, "es"));
  const sinCatalogo = grupos.filter(x => !x.enCatalogo).length;
  $("bk-metricas").innerHTML = `
    <div class="m-card"><div class="m-lbl">Brokers en el catálogo</div><div class="m-val">${listaBrokers().length}</div><div class="m-sub">${sinCatalogo ? `<span style="color:#b45309">⚠ ${sinCatalogo} escritos a mano sin crear</span>` : "todos creados"}</div></div>
    <div class="m-card"><div class="m-lbl">Pipeline activo vía brokers</div><div class="m-val" style="color:var(--blue)">${fmt(grupos.reduce((s, x) => s + x.act, 0))}</div><div class="m-sub">${grupos.reduce((s, x) => s + x.n, 0)} oportunidades</div></div>
    <div class="m-card"><div class="m-lbl">Ganado vía brokers</div><div class="m-val" style="color:var(--green)">${fmt(grupos.reduce((s, x) => s + x.gan, 0))}</div><div class="m-sub">en el año</div></div>`;
  $("bk-tbody").innerHTML = grupos.length ? grupos.map(x => `
    <tr class="bk-row" data-k="${esc(claveCuenta(x.nombre))}" style="cursor:pointer">
      <td><b>${esc(x.nombre)}</b>${x.enCatalogo ? (x.b.empresa ? `<div style="font-size:11px;color:var(--txt3)">${esc(x.b.empresa)}</div>` : "") : ` <span class="badge" style="background:#FEF3C7;color:#b45309">⚠ sin crear</span>`}</td>
      <td style="font-size:12px">${x.b ? [x.b.contacto, x.b.telefono].filter(Boolean).map(esc).join(" · ") || "—" : "—"}</td>
      <td style="text-align:right">${x.n}</td>
      <td style="text-align:right">${fmt(x.act)}</td>
      <td style="text-align:right;color:var(--green)">${fmt(x.gan)}</td>
      <td style="text-align:right;color:var(--red)">${fmt(x.per)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="lista-vacia">Aún no hay brokers. Usa “＋ Crear broker”.</td></tr>`;
  $("bk-tbody").querySelectorAll(".bk-row").forEach(tr => tr.addEventListener("click", () => { abierto = tr.dataset.k; pintarDetalle(); $("bk-det").classList.add("open"); }));
}

function pintarDetalle() {
  // Todas las oportunidades del broker (todos los años que el usuario puede ver)
  const ds = (opc.todos || []).filter(d => claveCuenta(d.broker) === abierto && String(d.broker || "").trim());
  const b = listaBrokers().find(x => claveCuenta(x.nombre) === abierto) || null;
  const nombre = b?.nombre || ds[0]?.broker || "";
  const suma = (f) => ds.filter(f).reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);
  const gan = ds.filter(d => d.estado === "Ganado").length, per = ds.filter(d => d.estado === "Perdido").length;
  $("bk-d-tit").textContent = "🤝 " + nombre;
  $("bk-d-body").innerHTML = `
    <div class="m-grid" style="margin-bottom:12px">
      <div class="m-card"><div class="m-lbl">Activo</div><div class="m-val" style="color:var(--blue)">${fmt(suma(d => ACTIVOS.has(d.estado)))}</div><div class="m-sub">${ds.filter(d => ACTIVOS.has(d.estado)).length} abiertas</div></div>
      <div class="m-card"><div class="m-lbl">Ganado</div><div class="m-val" style="color:var(--green)">${fmt(suma(d => d.estado === "Ganado"))}</div><div class="m-sub">${gan} oportunidad(es)</div></div>
      <div class="m-card"><div class="m-lbl">Perdido</div><div class="m-val" style="color:var(--red)">${fmt(suma(d => d.estado === "Perdido"))}</div><div class="m-sub">${per} · cierre ${gan + per ? Math.round(gan / (gan + per) * 100) + "%" : "—"}</div></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      ${b ? `<div style="font-size:13px;line-height:1.7">
        ${b.empresa ? `<b>Empresa:</b> ${esc(b.empresa)}<br>` : ""}
        ${b.contacto ? `<b>Contacto:</b> ${esc(b.contacto)}<br>` : ""}
        ${b.correo ? `<b>Correo:</b> <a href="mailto:${esc(b.correo)}">${esc(b.correo)}</a><br>` : ""}
        ${b.telefono ? `<b>Teléfono:</b> <a href="tel:${esc(b.telefono)}">${esc(b.telefono)}</a><br>` : ""}
        ${b.notas ? `<b>Notas:</b> ${esc(b.notas)}<br>` : ""}
        <span style="font-size:11px;color:var(--txt3)">Creado por ${esc(b.creadoPor || "—")}</span></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          ${esAdmin() ? `<button class="btn-secundario" id="bk-d-editar" style="font-size:12px">✏️ Editar</button>` : ""}
          <button class="btn-secundario" id="bk-d-tabla" style="font-size:12px">📋 Ver en la tabla</button></div>`
      : `<div style="font-size:13px;color:#b45309">⚠ Este broker está escrito en oportunidades pero no existe en el catálogo.</div>
         <button class="btn-primario" id="bk-d-crear" style="margin-top:10px;font-size:12px">＋ Crearlo en el catálogo</button>`}
    </div>
    <div class="card" style="padding:4px 12px">
      ${ds.length ? `<table class="tbl"><thead><tr><th>Oportunidad</th><th>Estado</th><th style="text-align:right">Valor</th></tr></thead><tbody>
        ${ds.sort((a, c) => (parseFloat(c.valor) || 0) - (parseFloat(a.valor) || 0)).map(d => `<tr class="bk-opp" data-id="${esc(d.id)}" style="cursor:pointer">
          <td><b>${esc(d.oportunidad)}</b><div style="font-size:11px;color:var(--txt3)">${esc(d.cuenta)} · ${esc(d.rep)}</div></td>
          <td>${badge(d.estado)}</td><td style="text-align:right">${fmt(d.valor)}</td></tr>`).join("")}
      </tbody></table>` : `<div class="lista-vacia">Sin oportunidades con este broker.</div>`}
    </div>`;
  const ed = $("bk-d-editar"); if (ed) ed.addEventListener("click", () => abrirForm(b));
  const tb = $("bk-d-tabla"); if (tb) tb.addEventListener("click", () => { abierto = ""; $("bk-det").classList.remove("open"); opc.onVerOportunidades(nombre); });
  const cr = $("bk-d-crear"); if (cr) cr.addEventListener("click", () => abrirForm(null, nombre));
  $("bk-d-body").querySelectorAll(".bk-opp").forEach(tr => tr.addEventListener("click", () => {
    const d = ds.find(x => x.id === tr.dataset.id);
    if (d && opc.onAbrirDeal) opc.onAbrirDeal(d);
  }));
}

function abrirForm(b, nombreSugerido) {
  editando = b;
  confirmar = false;
  $("bk-m-tit").textContent = b ? "Editar broker" : "Crear broker";
  $("bk-f-nombre").value = b?.nombre || nombreSugerido || "";
  $("bk-f-nombre").disabled = !!b;    // el nombre es la llave: no se cambia aquí
  $("bk-f-empresa").value = b?.empresa || "";
  $("bk-f-contacto").value = b?.contacto || "";
  $("bk-f-correo").value = b?.correo || "";
  $("bk-f-tel").value = b?.telefono || "";
  $("bk-f-notas").value = b?.notas || "";
  $("bk-f-err").textContent = "";
  $("bk-f-ok").textContent = "💾 Guardar";
  $("bk-f-borrar").style.display = b && esAdmin() ? "inline-block" : "none";
  $("bk-modal").classList.add("open");
  $("bk-f-nombre").focus();
}
function cerrarForm() { $("bk-modal").classList.remove("open"); editando = null; }

async function guardar() {
  const err = $("bk-f-err");
  const nombre = $("bk-f-nombre").value.trim().replace(/\s+/g, " ");
  const correo = $("bk-f-correo").value.trim();
  if (nombre.length < 2) { err.textContent = "Escribe el nombre del broker."; return; }
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { err.textContent = "El correo no es válido."; return; }
  const datos = {
    empresa: $("bk-f-empresa").value.trim(), contacto: $("bk-f-contacto").value.trim(),
    correo, telefono: $("bk-f-tel").value.trim(), notas: $("bk-f-notas").value.trim()
  };
  const btn = $("bk-f-ok");
  if (!editando) {
    const ex = brokerDe(nombre);
    if (ex) { err.textContent = `Ya existe el broker “${ex.nombre}”.`; return; }
    const parecidos = listaBrokers().filter(b => parecidoCuentas(nombre, b.nombre) >= 0.5).map(b => b.nombre);
    if (parecidos.length && !confirmar) {
      confirmar = true;
      err.textContent = `Se parece a: ${parecidos.slice(0, 3).join(", ")}. Si es otro broker, vuelve a guardar.`;
      btn.textContent = "Sí, es otro: guardar";
      return;
    }
  }
  btn.disabled = true;
  const u = obtenerUsuario();
  const res = editando
    ? await actualizarBroker(editando.id, datos)
    : await crearBroker({ nombre, ...datos, creadoPor: u?.nombreRep || "Gerencia" });
  btn.disabled = false;
  if (!res.ok) { err.textContent = res.error; return; }
  cerrarForm();
  toast(editando ? "✓ Broker actualizado" : `✓ Broker “${nombre}” creado`);
}

async function borrar() {
  if (!editando) return;
  if (!confirm(`¿Eliminar el broker “${editando.nombre}” del catálogo?\n\nSus oportunidades no se borran, pero quedarán con un broker sin crear.`)) return;
  const res = await eliminarBroker(editando.id);
  if (!res.ok) { $("bk-f-err").textContent = res.error; return; }
  cerrarForm();
  abierto = "";
  $("bk-det").classList.remove("open");
  toast("🗑 Broker eliminado");
}
