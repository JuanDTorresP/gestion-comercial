// ═══════════════════════════════════════════════════════════
// cuenta-editor.js — v1.0 (nov 2026) · SOLO GERENCIA
// ✏️ EDITAR CUENTA a mano, desde la Ficha, la pestaña Cuentas o
// 🧹 Calidad de datos:
//   📝 Datos      → nombre oficial, segmento, contactos (editar, borrar,
//                   marcar principal)
//   📦 Registros  → ver TODO lo que cuelga de la cuenta y mover
//                   oportunidades / gestiones a otra cuenta, asignando el
//                   broker por el que llegó (ej. "Worley · vía Isarco")
//   🔗 Unir       → juntar otras cuentas en esta
//   🗑 Eliminar   → solo si ya no tiene registros
// Todo se confirma antes de aplicar y se guarda con aplicarCambiosLote().
// ═══════════════════════════════════════════════════════════

import { esAdmin } from "./auth-service.js";
import { aplicarCambiosLote } from "./firestore-service.js";
import { SEGMENTOS, SEGMENTO_TXT, claveCuenta, parecidoCuentas, tokensCuenta, normSegmento, canalDeDeal } from "./catalogos.js";
import { alCambiarCatalogo, cuentaDe, listaCuentas, brokers as listaBrokers, brokerDe } from "./cuentas-store.js";
import { cambiosUnificar, registrosDeCuenta, cambiosMover, cambiosAsignarBroker } from "./cuentas-acciones.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmt(n) {
  n = parseFloat(n) || 0;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
let toastTimer = null;
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

let clave = "";            // cuenta abierta
let opts = {};
let pestana = "datos";
let contactos = [];        // edición en curso
let ocultosNuevos = new Set();
let selUnir = new Set();
let quitar = null;
let ocupado = false;
let sucio = false;         // hay cambios sin guardar en "Datos"

export function abrirEditorCuenta(nombre, opciones = {}) {
  if (!esAdmin()) return;
  const c = cuentaDe(nombre);
  if (!c) { toast("No encontramos esa cuenta"); return; }
  montar();
  clave = c.clave; opts = opciones; pestana = opciones.pestana || "datos";
  selUnir = new Set(); sucio = false;
  cargarContactos();
  if (!quitar) quitar = alCambiarCatalogo(() => { if ($("ce-modal")?.classList.contains("open") && !ocupado && !sucio) { cargarContactos(); render(); } });
  $("ce-modal").classList.add("open");
  render();
}

function cerrar() {
  if (sucio && !confirm("Tienes cambios sin guardar en Datos. ¿Cerrar de todas formas?")) return;
  $("ce-modal").classList.remove("open");
  clave = "";
}

function montar() {
  if ($("ce-modal")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <style>
      #ce-modal{z-index:650}
      .ce-box{max-width:980px!important}
      .ce-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
      .ce-tab{padding:6px 14px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .ce-tab.on{background:var(--blue);border-color:var(--blue);color:#fff}
      .ce-intro{font-size:12px;color:var(--txt2);background:var(--s2);border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.5}
      .ce-card{border:.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;background:var(--surface)}
      .ce-card h5{font-size:13px;margin-bottom:10px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
      .ce-grid{display:grid;grid-template-columns:2fr 1fr;gap:10px}
      .ce-ct{display:grid;grid-template-columns:28px 1.3fr 1fr 1.3fr 1fr 30px;gap:6px;align-items:center;margin-bottom:6px}
      .ce-ct input.form-input{padding:7px 9px;font-size:12px}
      .ce-ct .org{grid-column:2/-1;font-size:10px;color:var(--txt3);margin:-4px 0 4px}
      .ce-tbl{width:100%;border-collapse:collapse;font-size:12px}
      .ce-tbl th{text-align:left;color:var(--txt2);font-weight:600;padding:7px 6px;border-bottom:.5px solid var(--border);white-space:nowrap}
      .ce-tbl td{padding:7px 6px;border-bottom:.5px solid var(--border);vertical-align:top}
      .ce-tbl tr:hover td{background:var(--s2)}
      .ce-sub{font-size:11px;color:var(--txt3)}
      .ce-escrita{font-size:11px;color:#b45309}
      .ce-bar{position:sticky;bottom:-16px;background:var(--surface);border:1.5px solid var(--blue);border-radius:10px;padding:12px;margin-top:12px;display:grid;gap:8px;box-shadow:0 -6px 20px rgba(0,0,0,.06)}
      .ce-bar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .ce-bar-row .form-input,.ce-bar-row .form-select{flex:1;min-width:170px;padding:7px 10px;font-size:12px}
      .ce-btn{border:none;background:var(--blue);color:#fff;font-weight:600;font-size:12px;border-radius:8px;padding:8px 14px;cursor:pointer;font-family:inherit;white-space:nowrap}
      .ce-btn.sec{background:var(--blue-l);color:#1d4ed8}
      .ce-btn.peligro{background:var(--red-l);color:#b91c1c}
      .ce-btn:disabled{opacity:.45;cursor:default}
      .ce-cand{display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:.5px solid var(--border);font-size:13px}
      .ce-cand:last-child{border-bottom:none}
      .ce-err{font-size:12px;color:var(--red);margin-top:6px}
      @media(max-width:700px){.ce-grid{grid-template-columns:1fr}.ce-ct{grid-template-columns:24px 1fr 1fr 28px}.ce-ct .opc{display:none}}
    </style>
    <div class="modal-overlay" id="ce-modal">
      <div class="modal-box ce-box">
        <div class="modal-hdr"><span class="modal-title" id="ce-tit">✏️ Editar cuenta</span><button class="modal-close" id="ce-x">×</button></div>
        <div class="modal-body">
          <div class="ce-tabs" id="ce-tabs"></div>
          <div id="ce-body"></div>
        </div>
      </div>
    </div>
    <datalist id="ce-dl-ctas"></datalist>`;
  document.body.appendChild(div);
  $("ce-x").addEventListener("click", cerrar);
}

// ── Datos de la cuenta abierta ──
function cuenta() { return [...listaCuentas()].find(c => c.clave === clave) || null; }

function cargarContactos() {
  const c = cuenta();
  if (!c) { contactos = []; return; }
  const r = registrosDeCuenta(clave);
  const ficha = c.ficha;
  const ocultos = new Set((ficha?.contactosOcultos || []).map(plano));
  const lista = [];
  const sumar = (ct, origen) => {
    const nom = String(ct?.nombre || "").trim();
    if (!nom || ocultos.has(plano(nom))) return;
    let x = lista.find(y => plano(y.nombre) === plano(nom));
    if (!x) { x = { nombre: nom, cargo: "", correo: "", telefono: "", principal: false, origen, original: nom, fecha: ct.fecha || "", creadoPor: ct.creadoPor || "" }; lista.push(x); }
    ["cargo", "correo", "telefono"].forEach(k => { if (!x[k] && ct[k]) x[k] = ct[k]; });
    if (ct.principal) x.principal = true;
  };
  (ficha?.contactos || []).forEach(ct => sumar(ct, "Ficha"));
  r.gestiones.forEach(g => sumar({ nombre: g.contactoNombre, cargo: g.contactoCargo, correo: g.contactoCorreo, telefono: g.contactoTelefono, fecha: g.fecha }, "Agenda"));
  r.sprint.forEach(s => sumar({ nombre: s.contactoNombre, cargo: s.contactoCargo, correo: s.contactoCorreo, telefono: s.contactoTelefono }, "Base instalada"));
  if (lista.length && !lista.some(x => x.principal)) lista[0].principal = true;
  contactos = lista;
  ocultosNuevos = new Set();
}

function render() {
  const c = cuenta();
  if (!c) {
    $("ce-tit").textContent = "✏️ Editar cuenta";
    $("ce-tabs").innerHTML = "";
    $("ce-body").innerHTML = `<div class="ce-intro">✓ Esta cuenta ya no tiene registros ni ficha: todo lo que tenía se movió, se unió con otra o se renombró. Puedes cerrar esta ventana.</div>`;
    return;
  }
  const r = registrosDeCuenta(clave);
  $("ce-tit").textContent = "✏️ " + c.nombre;
  const tabs = [
    ["datos", "📝 Datos"],
    ["reg", `📦 Registros (${r.deals.length + r.gestiones.length + r.sprint.length})`],
    ["unir", "🔗 Unir cuentas"],
    ["borrar", "🗑 Eliminar"]
  ];
  $("ce-tabs").innerHTML = tabs.map(([k, t]) => `<button class="ce-tab ${k === pestana ? "on" : ""}" data-t="${k}">${t}</button>`).join("");
  $("ce-tabs").querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
    if (pestana === "datos" && sucio && !confirm("Tienes cambios sin guardar en Datos. ¿Cambiar de pestaña?")) return;
    if (pestana === "datos" && sucio) { sucio = false; cargarContactos(); }
    pestana = b.dataset.t; render();
  }));
  $("ce-dl-ctas").innerHTML = listaCuentas().filter(x => x.clave !== clave).map(x => `<option value="${esc(x.nombre)}">`).join("");
  const body = $("ce-body");
  if (pestana === "datos") { body.innerHTML = htmlDatos(c, r); activarDatos(c, r); }
  else if (pestana === "reg") { body.innerHTML = htmlRegistros(c, r); activarRegistros(c, r); }
  else if (pestana === "unir") { body.innerHTML = htmlUnir(c); activarUnir(c); }
  else { body.innerHTML = htmlBorrar(c, r); activarBorrar(c, r); }
}

async function aplicar(cambios, resumen, nombreFinal) {
  if (!cambios.length) { toast("No hay nada que cambiar"); return false; }
  const n = (col) => cambios.filter(x => x.col === col && !x.borrar).length;
  const borr = cambios.filter(x => x.borrar).length;
  if (!confirm(`${resumen}\n\nSe actualizarán: ${n("deals")} oportunidad(es), ${n("gestiones")} gestión(es), ${n("cuentasSprint")} cuenta(s) del Sprint, ${n("cuentas")} ficha(s)${n("brokers") ? `, ${n("brokers")} broker(s)` : ""}${borr ? ` y se borrarán ${borr} ficha(s)` : ""}.\n\n¿Aplicar?`)) return false;
  ocupado = true;
  const res = await aplicarCambiosLote(cambios);
  ocupado = false;
  sucio = false;
  if (!res.ok) alert(`Se aplicaron ${res.aplicados || 0} de ${cambios.length} cambios.\n\n${res.error}\n\nToma una captura de este mensaje para revisarlo.`);
  else toast(`✓ ${cambios.length} cambio(s) aplicados`);
  if (nombreFinal) clave = claveCuenta(nombreFinal);
  setTimeout(() => { cargarContactos(); render(); if (opts.onCambio) opts.onCambio(cuenta()?.nombre || nombreFinal || ""); }, 450);
  return res.ok;
}

// ═══════════════════════════════════════════
// 📝 DATOS
// ═══════════════════════════════════════════
function htmlDatos(c, r) {
  const variantes = Object.keys(c.variantes);
  return `
    <div class="ce-card">
      <h5>Nombre y segmento</h5>
      <div class="ce-grid">
        <div class="form-group"><label class="form-label">Nombre oficial *</label><input class="form-input" id="ce-nombre" value="${esc(c.nombre)}" maxlength="120"/></div>
        <div class="form-group"><label class="form-label">Segmento *</label><select class="form-select" id="ce-seg"><option value="">— Selecciona —</option>${SEGMENTOS.map(s => `<option value="${s}" ${s === c.segmento ? "selected" : ""}>${SEGMENTO_TXT[s]}</option>`).join("")}</select></div>
      </div>
      <div class="ce-sub" id="ce-nombre-aviso" style="margin-top:6px">${variantes.length > 1 ? `Escrita como: ${variantes.map(v => `“${esc(v)}”`).join(", ")} — al guardar, todas quedan con el nombre oficial.` : ""}</div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12px;margin-top:10px"><input type="checkbox" id="ce-seg-todo" checked/> Aplicar el segmento también a sus ${r.deals.length} oportunidad(es) y ${r.gestiones.length} gestión(es)</label>
    </div>
    <div class="ce-card">
      <h5><span>Contactos (${contactos.length})</span><button class="ce-btn sec" id="ce-ct-mas">＋ Agregar contacto</button></h5>
      <div class="ce-sub" style="margin:-4px 0 10px">⭐ = contacto principal. Los que vienen de la Agenda o de la base instalada quedan guardados en la ficha al guardar. Borrar un contacto lo oculta en toda la app.</div>
      <div id="ce-cts">${contactos.length ? contactos.map((x, i) => `
        <div class="ce-ct">
          <input type="radio" name="ce-princ" data-i="${i}" ${x.principal ? "checked" : ""} title="Contacto principal"/>
          <input class="form-input" data-i="${i}" data-k="nombre" value="${esc(x.nombre)}" placeholder="Nombre *"/>
          <input class="form-input opc" data-i="${i}" data-k="cargo" value="${esc(x.cargo)}" placeholder="Cargo"/>
          <input class="form-input opc" data-i="${i}" data-k="correo" value="${esc(x.correo)}" placeholder="Correo"/>
          <input class="form-input" data-i="${i}" data-k="telefono" value="${esc(x.telefono)}" placeholder="Teléfono"/>
          <button class="btn-editar" data-borrar="${i}" title="Borrar contacto">🗑</button>
          ${x.origen !== "Ficha" ? `<div class="org">viene de: ${esc(x.origen)}</div>` : ""}
        </div>`).join("") : `<div class="ce-sub">Sin contactos.</div>`}</div>
    </div>
    <div class="ce-err" id="ce-datos-err"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
      <button class="btn-secundario" id="ce-datos-reset">Deshacer</button>
      <button class="btn-primario" id="ce-datos-ok">💾 Guardar cambios</button>
    </div>`;
}

function activarDatos(c, r) {
  const body = $("ce-body");
  const marcar = () => { sucio = true; };
  $("ce-nombre").addEventListener("input", () => {
    marcar();
    const n = $("ce-nombre").value.trim();
    const otra = cuentaDe(n);
    const av = $("ce-nombre-aviso");
    if (otra && otra.clave !== clave) av.innerHTML = `<span style="color:#b45309">⚠ Ya existe “${esc(otra.nombre)}”: al guardar, las dos cuentas se UNIRÁN en una sola.</span>`;
    else if (n && n !== c.nombre) av.innerHTML = `Se renombrará en ${r.deals.length} oportunidad(es), ${r.gestiones.length} gestión(es)${r.sprint.length ? " y la base instalada" : ""}.`;
    else av.textContent = "";
  });
  $("ce-seg").addEventListener("change", marcar);
  body.querySelectorAll("#ce-cts input[data-k]").forEach(inp => inp.addEventListener("input", () => {
    contactos[parseInt(inp.dataset.i)][inp.dataset.k] = inp.value; marcar();
  }));
  body.querySelectorAll("input[name=ce-princ]").forEach(rd => rd.addEventListener("change", () => {
    contactos.forEach((x, i) => x.principal = i === parseInt(rd.dataset.i)); marcar();
  }));
  body.querySelectorAll("[data-borrar]").forEach(b => b.addEventListener("click", () => {
    const i = parseInt(b.dataset.borrar);
    const x = contactos[i];
    if (x.original) ocultosNuevos.add(x.original);
    contactos.splice(i, 1);
    if (contactos.length && !contactos.some(y => y.principal)) contactos[0].principal = true;
    sucio = true; render();
  }));
  $("ce-ct-mas").addEventListener("click", () => {
    contactos.push({ nombre: "", cargo: "", correo: "", telefono: "", principal: !contactos.length, origen: "Ficha", original: "", fecha: "", creadoPor: "Gerencia" });
    sucio = true; render();
    const ins = body.querySelectorAll('#ce-cts input[data-k="nombre"]');
    if (ins.length) ins[ins.length - 1].focus();
  });
  $("ce-datos-reset").addEventListener("click", () => { sucio = false; cargarContactos(); render(); });
  $("ce-datos-ok").addEventListener("click", () => guardarDatos(c, r));
}

async function guardarDatos(c, r) {
  const err = $("ce-datos-err");
  err.textContent = "";
  const nombre = $("ce-nombre").value.trim().replace(/\s+/g, " ");
  const segmento = $("ce-seg").value;
  if (nombre.length < 2) { err.textContent = "Escribe el nombre oficial."; return; }
  if (!segmento) { err.textContent = "Elige el segmento."; return; }
  const lista = contactos.map(x => ({ ...x, nombre: String(x.nombre || "").trim() })).filter(x => x.nombre);
  for (const x of lista) {
    if (x.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.correo.trim())) { err.textContent = `El correo de ${x.nombre} no es válido.`; return; }
  }
  const nombresCt = lista.map(x => plano(x.nombre));
  if (new Set(nombresCt).size !== nombresCt.length) { err.textContent = "Hay dos contactos con el mismo nombre."; return; }

  const otra = cuentaDe(nombre);
  const uniendo = otra && otra.clave !== clave;
  const renombrando = nombre !== c.nombre || uniendo;
  const nombreFinal = nombre;
  const variantes = [...Object.keys(c.variantes), ...(uniendo ? Object.keys(otra.variantes) : [])];
  const cambios = renombrando ? cambiosUnificar(nombreFinal, variantes) : [];

  // Ficha final: contactos editados (principal primero) + los de la otra cuenta si se unen
  const principal = lista.find(x => x.principal) ? lista.filter(x => x.principal) : [];
  const ordenados = [...principal, ...lista.filter(x => !x.principal)].map((x, i) => ({
    nombre: x.nombre, cargo: (x.cargo || "").trim(), correo: (x.correo || "").trim(), telefono: (x.telefono || "").trim(),
    principal: i === 0 && !!x.principal, creadoPor: x.creadoPor || "Gerencia", fecha: x.fecha || ""
  }));
  if (uniendo) (otra.ficha?.contactos || []).forEach(ct => {
    if (ct?.nombre && !ordenados.some(y => plano(y.nombre) === plano(ct.nombre))) ordenados.push({ ...ct, principal: false });
  });
  const ocultos = new Set([...(c.ficha?.contactosOcultos || []), ...(uniendo ? otra.ficha?.contactosOcultos || [] : []), ...ocultosNuevos]);
  ordenados.forEach(x => { for (const o of [...ocultos]) if (plano(o) === plano(x.nombre)) ocultos.delete(o); });
  const fichaId = renombrando ? claveCuenta(nombreFinal) : (c.fichaId || clave);
  const ficha = { nombre: nombreFinal, segmento, contactos: ordenados, contactosOcultos: [...ocultos] };
  if (!c.fichaId && !renombrando) Object.assign(ficha, { creadoPor: "Gerencia", origen: "Editar cuenta" });
  cambios.push({ col: "cuentas", id: fichaId, crear: ficha });

  // Segmento en oportunidades y gestiones
  if ($("ce-seg-todo").checked) {
    const regs = uniendo ? { deals: [...r.deals, ...registrosDeCuenta(otra.clave).deals], gestiones: [...r.gestiones, ...registrosDeCuenta(otra.clave).gestiones] } : r;
    regs.deals.forEach(d => { if (normSegmento(d.segmento) !== segmento || d.segmento !== segmento) sumarDatos(cambios, "deals", d.id, { segmento }); });
    regs.gestiones.forEach(g => { if (g.segmento !== segmento) sumarDatos(cambios, "gestiones", g.id, { segmento }); });
  }
  const resumen = uniendo ? `Unir “${c.nombre}” con “${otra.nombre}” bajo el nombre “${nombreFinal}” y guardar sus datos.`
    : renombrando ? `Renombrar “${c.nombre}” a “${nombreFinal}” y guardar sus datos.` : `Guardar los datos de “${c.nombre}”.`;
  await aplicar(cambios, resumen, nombreFinal);
}
// Junta en un solo cambio los campos de un mismo documento
function sumarDatos(cambios, col, id, datos) {
  const ya = cambios.find(x => x.col === col && x.id === id && x.datos);
  if (ya) Object.assign(ya.datos, datos);
  else cambios.push({ col, id, datos });
}

// ═══════════════════════════════════════════
// 📦 REGISTROS (mover a otra cuenta · asignar broker)
// ═══════════════════════════════════════════
function htmlRegistros(c, r) {
  const escrita = (x) => x.cuenta !== c.nombre ? `<div class="ce-escrita">escrita: “${esc(x.cuenta)}”</div>` : "";
  const deals = [...r.deals].sort((a, b) => String(a.oportunidad || "").localeCompare(String(b.oportunidad || ""), "es"));
  const gs = [...r.gestiones].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  const brkOpts = listaBrokers().map(b => `<option value="${esc(b.nombre)}">${esc(b.nombre)}</option>`).join("");
  const puedeSerBroker = !brokerDe(c.nombre);
  return `
    <div class="ce-intro">Aquí ves todo lo que hoy cuelga de <b>${esc(c.nombre)}</b>. Marca lo que pertenece a otro cliente y muévelo. Ejemplo: si en <b>Isarco</b> hay oportunidades que en realidad son de <b>Worley</b>, márcalas, escribe “Worley” como destino y elige el broker <b>Isarco</b>: quedan en la cuenta Worley con canal Indirecto · Broker Isarco.</div>

    <div class="ce-card">
      <h5><span>💼 Oportunidades (${deals.length})</span>${deals.length ? `<label class="ce-sub"><input type="checkbox" id="ce-all-d"/> todas</label>` : ""}</h5>
      ${deals.length ? `<table class="ce-tbl"><thead><tr><th></th><th>Oportunidad</th><th>Estado</th><th style="text-align:right">Valor</th><th>Canal · Broker</th><th>Rep</th></tr></thead><tbody>
        ${deals.map(d => `<tr><td><input type="checkbox" class="ce-chk" data-col="deals" data-id="${esc(d.id)}"/></td>
          <td><b>${esc(d.oportunidad) || "(sin nombre)"}</b>${escrita(d)}</td><td>${esc(d.estado || "")}</td>
          <td style="text-align:right">${fmt(d.valor)}</td><td>${esc(canalDeDeal(d) || "—")}${d.broker ? ` · 🤝 ${esc(d.broker)}` : ""}</td><td>${esc((d.rep || "").split(" ")[0])}</td></tr>`).join("")}
      </tbody></table>` : `<div class="ce-sub">Sin oportunidades.</div>`}
    </div>

    <div class="ce-card">
      <h5><span>🗒 Gestiones (${gs.length})</span>${gs.length ? `<label class="ce-sub"><input type="checkbox" id="ce-all-g"/> todas</label>` : ""}</h5>
      ${gs.length ? `<table class="ce-tbl"><thead><tr><th></th><th>Fecha</th><th>Gestión</th><th>Rep</th></tr></thead><tbody>
        ${gs.map(g => `<tr><td><input type="checkbox" class="ce-chk" data-col="gestiones" data-id="${esc(g.id)}"/></td>
          <td style="white-space:nowrap">${esc(g.fecha || "")}</td>
          <td><b>${esc(g.oportunidad || g.tipo || "")}</b>${escrita(g)}${g.notas ? `<div class="ce-sub">${esc(String(g.notas).slice(0, 140))}${String(g.notas).length > 140 ? "…" : ""}</div>` : ""}</td>
          <td>${esc((g.rep || "").split(" ")[0])}</td></tr>`).join("")}
      </tbody></table>` : `<div class="ce-sub">Sin gestiones.</div>`}
    </div>

    ${r.sprint.length ? `<div class="ce-card"><h5>🚀 Base instalada (Sprint)</h5>
      ${r.sprint.map(s => `<label class="ce-cand"><input type="checkbox" class="ce-chk" data-col="sprint" data-id="${esc(s.id)}"/> ${esc(s.cuenta)} <span class="ce-sub">· ${esc(s.rep || "")}</span></label>`).join("")}</div>` : ""}

    <div class="ce-bar">
      <div class="ce-sub"><b id="ce-nsel">0</b> registro(s) marcados</div>
      <div class="ce-bar-row">
        <input class="form-input" id="ce-dest" list="ce-dl-ctas" placeholder="Mover a la cuenta… (existente o nueva)" autocomplete="off"/>
        <select class="form-select" id="ce-dest-seg" style="display:none"><option value="">Segmento de la cuenta nueva…</option>${SEGMENTOS.map(s => `<option value="${s}">${SEGMENTO_TXT[s]}</option>`).join("")}</select>
        <select class="form-select" id="ce-brk">
          <option value="">Broker: sin cambio</option>
          ${brkOpts}
          ${puedeSerBroker ? `<option value="__crear__">＋ Crear broker “${esc(c.nombre)}”</option>` : ""}
        </select>
      </div>
      <div class="ce-sub" id="ce-dest-aviso"></div>
      <div class="ce-bar-row" style="justify-content:flex-end">
        <button class="ce-btn sec" id="ce-solo-brk" disabled>Solo asignar broker a las oportunidades</button>
        <button class="ce-btn" id="ce-mover" disabled>Mover a esa cuenta</button>
      </div>
    </div>`;
}

function seleccion() {
  const sel = { deals: [], gestiones: [], sprint: [] };
  $("ce-body").querySelectorAll(".ce-chk:checked").forEach(ch => sel[ch.dataset.col].push(ch.dataset.id));
  return sel;
}
function brokerElegido(c) {
  const v = $("ce-brk").value;
  if (!v) return null;
  if (v === "__crear__") return { nombre: c.nombre, crear: true };
  return { nombre: brokerDe(v)?.nombre || v, crear: false };
}

function activarRegistros(c, r) {
  const body = $("ce-body");
  const actualizar = () => {
    const s = seleccion();
    const n = s.deals.length + s.gestiones.length + s.sprint.length;
    $("ce-nsel").textContent = n;
    const dest = $("ce-dest").value.trim();
    const dc = cuentaDe(dest);
    $("ce-dest-seg").style.display = dest && (!dc || !dc.segmento) ? "" : "none";
    $("ce-dest-aviso").innerHTML = !dest ? "" : dc ? (dc.clave === clave ? `<span style="color:#b45309">Es esta misma cuenta.</span>` : `✓ Cuenta existente: <b>${esc(dc.nombre)}</b>`)
      : `<span style="color:#b45309">“${esc(dest)}” no existe: se creará como cuenta nueva.</span>`;
    $("ce-mover").disabled = !n || !dest || (dc && dc.clave === clave);
    $("ce-solo-brk").disabled = !s.deals.length || !$("ce-brk").value;
  };
  body.querySelectorAll(".ce-chk").forEach(ch => ch.addEventListener("change", actualizar));
  const todas = (id, col) => { const el = $(id); if (el) el.addEventListener("change", () => { body.querySelectorAll(`.ce-chk[data-col="${col}"]`).forEach(ch => ch.checked = el.checked); actualizar(); }); };
  todas("ce-all-d", "deals"); todas("ce-all-g", "gestiones");
  $("ce-dest").addEventListener("input", actualizar);
  $("ce-brk").addEventListener("change", actualizar);
  $("ce-dest-seg").addEventListener("change", actualizar);
  actualizar();

  $("ce-mover").addEventListener("click", async () => {
    const s = seleccion();
    const dest = $("ce-dest").value.trim().replace(/\s+/g, " ");
    const dc = cuentaDe(dest);
    const seg = $("ce-dest-seg").value;
    if ((!dc || !dc.segmento) && !seg) { $("ce-dest-aviso").innerHTML = `<span style="color:#b91c1c">Elige el segmento de la cuenta destino.</span>`; return; }
    const brk = brokerElegido(c);
    const cambios = cambiosMover(s, dest, { segmento: seg, broker: brk });
    // Si la cuenta destino ya tenía ficha sin segmento, se completa
    if (dc?.fichaId && !dc.segmento && seg) cambios.push({ col: "cuentas", id: dc.fichaId, crear: { segmento: seg } });
    const total = s.deals.length + s.gestiones.length + s.sprint.length;
    await aplicar(cambios, `Mover ${total} registro(s) de “${c.nombre}” a “${dc?.nombre || dest}”${brk && s.deals.length ? ` con broker “${brk.nombre}”` : ""}.`);
  });
  $("ce-solo-brk").addEventListener("click", async () => {
    const s = seleccion();
    const brk = brokerElegido(c);
    if (!brk) return;
    await aplicar(cambiosAsignarBroker(s.deals, brk), `Asignar el broker “${brk.nombre}” a ${s.deals.length} oportunidad(es) (canal Indirecto · origen Broker).`);
  });
}

// ═══════════════════════════════════════════
// 🔗 UNIR CUENTAS
// ═══════════════════════════════════════════
function candidatas(c) {
  const mias = new Set(tokensCuenta(c.nombre).filter(w => w.length >= 4));
  return listaCuentas().filter(x => x.clave !== clave).map(x => {
    const p = parecidoCuentas(c.nombre, x.nombre);
    const comparte = tokensCuenta(x.nombre).some(w => mias.has(w));
    return { x, p: Math.max(p, comparte ? 0.5 : 0) };
  }).filter(y => y.p >= 0.5).sort((a, b) => b.p - a.p).slice(0, 25).map(y => y.x);
}
function htmlUnir(c) {
  const cand = candidatas(c);
  const extra = [...selUnir].map(k => listaCuentas().find(x => x.clave === k)).filter(x => x && !cand.includes(x));
  const uso = (x) => [x.nDeals ? `${x.nDeals} oport.` : "", x.nGestiones ? `${x.nGestiones} gest.` : "", x.enSprint ? "base instalada" : ""].filter(Boolean).join(" · ");
  return `
    <div class="ce-intro">Marca las cuentas que son el mismo cliente que <b>${esc(c.nombre)}</b>. Todas sus oportunidades, gestiones, base instalada y contactos pasan a <b>${esc(c.nombre)}</b> y las otras desaparecen.<br>
    ⚠ Si una cuenta mezcla dos clientes (ej. “Worley - Isarco”), no la unas: ábrela y usa <b>📦 Registros</b> para mover cada registro a donde corresponde.</div>
    <div class="ce-card">
      <h5>Cuentas parecidas</h5>
      ${[...cand, ...extra].length ? [...cand, ...extra].map(x => `<label class="ce-cand"><input type="checkbox" class="ce-unir" data-k="${esc(x.clave)}" ${selUnir.has(x.clave) ? "checked" : ""}/>
        <b>${esc(x.nombre)}</b> <span class="ce-sub">${uso(x)}</span>
        <button type="button" class="ce-btn sec" data-abrir="${esc(x.nombre)}" style="margin-left:auto;padding:4px 10px">Abrir</button></label>`).join("")
      : `<div class="ce-sub">No encontramos cuentas parecidas. Búscala abajo.</div>`}
    </div>
    <div class="ce-card">
      <h5>Buscar otra cuenta</h5>
      <div class="ce-bar-row"><input class="form-input" id="ce-buscar" list="ce-dl-ctas" placeholder="Escribe el nombre…" autocomplete="off"/><button class="ce-btn sec" id="ce-agregar">Agregar a la lista</button></div>
    </div>
    <div style="display:flex;justify-content:flex-end"><button class="ce-btn" id="ce-unir-ok" ${selUnir.size ? "" : "disabled"}>Unir ${selUnir.size || ""} cuenta(s) en “${esc(c.nombre)}”</button></div>`;
}
function activarUnir(c) {
  const body = $("ce-body");
  body.querySelectorAll(".ce-unir").forEach(ch => ch.addEventListener("change", () => { if (ch.checked) selUnir.add(ch.dataset.k); else selUnir.delete(ch.dataset.k); render(); }));
  body.querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", (e) => { e.preventDefault(); abrirEditorCuenta(b.dataset.abrir, opts); }));
  $("ce-agregar").addEventListener("click", () => {
    const x = cuentaDe($("ce-buscar").value);
    if (!x) { toast("Elige una cuenta de la lista"); return; }
    if (x.clave === clave) { toast("Es esta misma cuenta"); return; }
    selUnir.add(x.clave); render();
  });
  $("ce-unir-ok").addEventListener("click", async () => {
    const otras = [...selUnir].map(k => listaCuentas().find(x => x.clave === k)).filter(Boolean);
    const variantes = [...Object.keys(c.variantes), ...otras.flatMap(x => Object.keys(x.variantes))];
    const ok = await aplicar(cambiosUnificar(c.nombre, variantes), `Unir ${otras.map(x => `“${x.nombre}”`).join(", ")} en “${c.nombre}”.`, c.nombre);
    if (ok) selUnir = new Set();
  });
}

// ═══════════════════════════════════════════
// 🗑 ELIMINAR
// ═══════════════════════════════════════════
function htmlBorrar(c, r) {
  const n = r.deals.length + r.gestiones.length + r.sprint.length;
  if (n) return `<div class="ce-intro">“${esc(c.nombre)}” tiene ${r.deals.length} oportunidad(es), ${r.gestiones.length} gestión(es)${r.sprint.length ? " y está en la base instalada" : ""}. Para eliminarla primero <b>múevelos</b> a otra cuenta (📦 Registros) o <b>únela</b> con la cuenta correcta (🔗 Unir).</div>`;
  return `<div class="ce-intro">“${esc(c.nombre)}” no tiene oportunidades, gestiones ni base instalada. Puedes eliminar su ficha (se pierden sus contactos).</div>
    <button class="ce-btn peligro" id="ce-borrar-ok">🗑 Eliminar la cuenta “${esc(c.nombre)}”</button>`;
}
function activarBorrar(c, r) {
  const b = $("ce-borrar-ok");
  if (!b) return;
  b.addEventListener("click", async () => {
    const cambios = r.fichas.map(f => ({ col: "cuentas", id: f.id, borrar: true }));
    const ok = await aplicar(cambios, `Eliminar la cuenta “${c.nombre}”.`);
    if (ok) { $("ce-modal").classList.remove("open"); clave = ""; }
  });
}
