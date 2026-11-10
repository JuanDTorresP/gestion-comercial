// ═══════════════════════════════════════════════════════════
// calidad-datos.js — v1.0 (nov 2026) · SOLO GERENCIA
// 🧹 Herramienta para dejar la base limpia y precisa:
//   1. Cuentas duplicadas → unifica "Provet SAS" / "PROVET S.A." en un
//      solo nombre oficial y corrige Pipeline, Agenda, Sprint y fichas.
//   2. Segmento de cuentas → crea las fichas que falten y completa
//      Retail / Corporativo / Público.
//   3. Valores de campos → traduce lo escrito a mano en tipo, canal,
//      origen y segmento de las oportunidades a las listas cerradas.
//   4. Brokers → crea en el catálogo los brokers escritos a mano o los
//      une con uno existente.
// Todo se muestra ANTES de aplicar y se guarda en lotes (writeBatch).
// Las reglas de Firestore solo permiten estos cambios a Gerencia.
// ═══════════════════════════════════════════════════════════

import { esAdmin } from "./auth-service.js";
import { aplicarCambiosLote } from "./firestore-service.js";
import {
  TIPOS, CANALES, ORIGENES, SEGMENTOS, SEGMENTO_TXT,
  claveCuenta, parecidoCuentas, normTipo, normCanal, normOrigen, normSegmento, segmentoDeRegistro
} from "./catalogos.js";
import { alCambiarCatalogo, datosCatalogo, listaCuentas, cuentasConVariantes, brokers as listaBrokers, brokerDe, cuentaDe } from "./cuentas-store.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastTimer = null;
function toast(msg) {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

let pestana = "dup";
let quitar = null;
const ignorados = new Set();   // pares "a|b" marcados como distintos en esta sesión
let ocupado = false;

export function abrirCalidadDatos() {
  if (!esAdmin()) return;
  montar();
  $("cd-modal").classList.add("open");
  if (!quitar) quitar = alCambiarCatalogo(() => { if ($("cd-modal")?.classList.contains("open") && !ocupado) render(); });
  render();
}

function montar() {
  if ($("cd-modal")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <style>
      .cd-box{max-width:980px!important}
      .cd-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
      .cd-tab{padding:6px 14px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--txt2);font-family:inherit}
      .cd-tab.on{background:var(--blue);border-color:var(--blue);color:#fff}
      .cd-n{display:inline-block;min-width:18px;padding:0 6px;border-radius:99px;background:rgba(0,0,0,.08);margin-left:4px;font-size:11px}
      .cd-tab.on .cd-n{background:rgba(255,255,255,.25)}
      .cd-grupo{border:.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--surface)}
      .cd-grupo h5{font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
      .cd-var{display:flex;gap:8px;align-items:center;font-size:13px;padding:3px 0}
      .cd-var small{color:var(--txt3)}
      .cd-acc{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .cd-acc button,.cd-btn{border:none;background:var(--blue-l);color:#1d4ed8;font-weight:600;font-size:12px;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit}
      .cd-acc button.sec{background:var(--s2);color:var(--txt2)}
      .cd-intro{font-size:12px;color:var(--txt2);background:var(--s2);border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.5}
      .cd-tbl{width:100%;border-collapse:collapse;font-size:12px}
      .cd-tbl th{text-align:left;color:var(--txt2);font-weight:600;padding:7px 6px;border-bottom:.5px solid var(--border)}
      .cd-tbl td{padding:7px 6px;border-bottom:.5px solid var(--border);vertical-align:middle}
      .cd-tbl select{padding:5px 8px;font-size:12px}
      .cd-vacio{font-size:13px;color:#15803d;padding:14px;background:var(--green-l);border-radius:10px}
      .cd-sub{font-size:13px;font-weight:700;margin:16px 0 8px}
    </style>
    <div class="modal-overlay" id="cd-modal">
      <div class="modal-box cd-box">
        <div class="modal-hdr"><span class="modal-title">🧹 Calidad de datos</span><button class="modal-close" id="cd-x">×</button></div>
        <div class="modal-body">
          <div class="cd-tabs" id="cd-tabs"></div>
          <div id="cd-body"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div);
  $("cd-x").addEventListener("click", () => $("cd-modal").classList.remove("open"));
}

// ═══════════════════════════════════════════
// DIAGNÓSTICO
// ═══════════════════════════════════════════
function diag() {
  const d = datosCatalogo();
  const dups = cuentasConVariantes();
  // Posibles duplicados con llave distinta (palabras en común)
  const cuentas = listaCuentas();
  const porPalabra = new Map();
  cuentas.forEach(c => c.clave.split("-").filter(w => w.length >= 4).forEach(w => {
    if (!porPalabra.has(w)) porPalabra.set(w, []);
    porPalabra.get(w).push(c);
  }));
  const vistos = new Set(), parecidas = [];
  porPalabra.forEach(lista => {
    if (lista.length > 30) return;   // palabra demasiado común
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const a = lista[i], b = lista[j];
      const par = [a.clave, b.clave].sort().join("|");
      if (vistos.has(par) || ignorados.has(par)) continue;
      vistos.add(par);
      const p = parecidoCuentas(a.nombre, b.nombre);
      if (p >= 0.6) parecidas.push({ a, b, p, par });
    }
  });
  parecidas.sort((x, y) => y.p - x.p);

  const sinFicha = cuentas.filter(c => !c.fichaId && (c.nDeals || c.nGestiones || c.enSprint));
  const sinSegmento = cuentas.filter(c => !c.segmento);

  // Valores fuera de lista en oportunidades
  const campos = {
    tipo: { t: "Tipo", ops: TIPOS, norm: normTipo },
    canal: { t: "Canal", ops: CANALES, norm: normCanal },
    origen: { t: "Origen", ops: ORIGENES, norm: normOrigen },
    segmento: { t: "Segmento", ops: SEGMENTOS, norm: normSegmento }
  };
  const valores = {};
  Object.entries(campos).forEach(([k, def]) => {
    const m = {};
    d.deals.forEach(x => {
      const raw = String(x[k] ?? "").trim();
      if (!raw || def.ops.includes(raw)) return;
      m[raw] = (m[raw] || 0) + 1;
    });
    valores[k] = Object.entries(m).sort((a, b) => b[1] - a[1]);
  });
  // Oportunidades sin segmento que se pueden completar
  const segCompletables = d.deals.filter(x => !SEGMENTOS.includes(String(x.segmento || "").trim()))
    .map(x => ({ x, seg: normSegmento(x.segmento) || normSegmento(x.canal) || cuentaDe(x.cuenta)?.segmento || "" }))
    .filter(y => y.seg);
  const canalCompletables = d.deals.filter(x => String(x.broker || "").trim() && !String(x.canal || "").trim());

  // Brokers escritos a mano
  const bk = {};
  d.deals.forEach(x => {
    const raw = String(x.broker || "").trim();
    if (!raw) return;
    const cat = brokerDe(raw);
    if (cat && cat.nombre === raw) return;
    const k = claveCuenta(raw);
    bk[k] = bk[k] || { nombre: raw, variantes: {}, n: 0, cat };
    bk[k].variantes[raw] = (bk[k].variantes[raw] || 0) + 1;
    bk[k].n++;
  });
  const brokersPend = Object.values(bk).sort((a, b) => b.n - a.n);

  const nValores = Object.values(valores).reduce((s, l) => s + l.length, 0) + (segCompletables.length ? 1 : 0) + (canalCompletables.length ? 1 : 0);
  return { d, dups, parecidas, sinFicha, sinSegmento, campos, valores, segCompletables, canalCompletables, brokersPend, nValores };
}

function render() {
  if (!$("cd-modal")) return;
  const g = diag();
  const tabs = [
    ["dup", "🏢 Cuentas duplicadas", g.dups.length + g.parecidas.length],
    ["seg", "🏷 Segmento de cuentas", g.sinSegmento.length + (g.sinFicha.length ? 1 : 0)],
    ["val", "🔤 Valores de campos", g.nValores],
    ["bk", "🤝 Brokers", g.brokersPend.length]
  ];
  $("cd-tabs").innerHTML = tabs.map(([k, t, n]) => `<button class="cd-tab ${k === pestana ? "on" : ""}" data-t="${k}">${t}<span class="cd-n">${n}</span></button>`).join("");
  $("cd-tabs").querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { pestana = b.dataset.t; render(); }));
  const body = $("cd-body");
  if (pestana === "dup") body.innerHTML = htmlDup(g);
  else if (pestana === "seg") body.innerHTML = htmlSeg(g);
  else if (pestana === "val") body.innerHTML = htmlVal(g);
  else body.innerHTML = htmlBk(g);
  activar(g);
}

// ── 1. Cuentas duplicadas ──
function fuentes(c) {
  return [c.nDeals ? `${c.nDeals} oportunidad(es)` : "", c.nGestiones ? `${c.nGestiones} gestión(es)` : "", c.enSprint ? "base instalada" : "", c.fichas.length ? `${c.fichas.length} ficha(s)` : ""].filter(Boolean).join(" · ");
}
function htmlDup(g) {
  const nombres = listaCuentas().map(c => `<option value="${esc(c.nombre)}">`).join("");
  return `
    <div class="cd-intro">Al unificar, <b>todas</b> las oportunidades, gestiones, cuentas del Sprint y fichas quedan con el nombre oficial que elijas, y los contactos de las fichas se juntan. Las mayúsculas, tildes, puntos y SAS/SA/LTDA ya no separan cuentas.</div>
    <div class="cd-sub">Escritas de varias formas (${g.dups.length})</div>
    ${g.dups.length ? `<div class="cd-acc" style="margin:-2px 0 10px"><button id="cd-dup-todas">Unificar todas con el nombre sugerido</button></div>` +
      g.dups.map((c, i) => `<div class="cd-grupo">
        <h5><span>${esc(c.nombre)}</span><small style="font-weight:400;color:var(--txt3)">${fuentes(c)}</small></h5>
        ${Object.entries(c.variantes).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<label class="cd-var"><input type="radio" name="cd-of-${i}" value="${esc(v)}" ${v === c.nombre ? "checked" : ""}/> ${esc(v)} <small>(${n} registro${n === 1 ? "" : "s"})</small></label>`).join("")}
        <div class="cd-acc"><button data-unificar="${i}">Unificar con el nombre elegido</button></div>
      </div>`).join("") : `<div class="cd-vacio">✓ No hay cuentas escritas de varias formas.</div>`}

    <div class="cd-sub">Posibles duplicados con nombre distinto (${g.parecidas.length})</div>
    ${g.parecidas.length ? g.parecidas.slice(0, 40).map((x, i) => `<div class="cd-grupo">
        <div class="cd-var"><b>${esc(x.a.nombre)}</b> <small>${fuentes(x.a)}</small></div>
        <div class="cd-var"><b>${esc(x.b.nombre)}</b> <small>${fuentes(x.b)}</small></div>
        <div class="cd-acc">
          <button data-par="${i}" data-dest="a">Unir en “${esc(x.a.nombre)}”</button>
          <button data-par="${i}" data-dest="b">Unir en “${esc(x.b.nombre)}”</button>
          <button class="sec" data-ignorar="${esc(x.par)}">No son la misma</button>
        </div></div>`).join("") + (g.parecidas.length > 40 ? `<div class="cd-intro">Mostrando 40 de ${g.parecidas.length}.</div>` : "")
      : `<div class="cd-vacio">✓ No encontramos cuentas parecidas.</div>`}

    <div class="cd-sub">Unir dos cuentas a mano</div>
    <div class="cd-grupo">
      <datalist id="cd-dl-ctas">${nombres}</datalist>
      <div style="display:grid;grid-template-columns:1fr auto 1fr auto;gap:8px;align-items:center">
        <input class="form-input" id="cd-man-a" list="cd-dl-ctas" placeholder="Cuenta que desaparece"/>
        <span>→</span>
        <input class="form-input" id="cd-man-b" list="cd-dl-ctas" placeholder="Cuenta oficial (se conserva)"/>
        <button class="cd-btn" id="cd-man-ok">Unir</button>
      </div>
    </div>`;
}

// Arma todos los cambios para dejar `nombres` como una sola cuenta `oficial`
function cambiosUnificar(oficial, nombres) {
  const d = datosCatalogo();
  const claves = new Set([oficial, ...nombres].map(claveCuenta));
  const claveOf = claveCuenta(oficial);
  const cambios = [];
  d.deals.forEach(x => {
    if (claves.has(claveCuenta(x.cuenta)) && (x.cuenta !== oficial || x.cuentaId !== claveOf))
      cambios.push({ col: "deals", id: x.id, datos: { cuenta: oficial, cuentaId: claveOf } });
  });
  d.gestionesTodas.forEach(x => {
    if (claves.has(claveCuenta(x.cuenta)) && (x.cuenta !== oficial || x.cuentaId !== claveOf))
      cambios.push({ col: "gestiones", id: x.id, datos: { cuenta: oficial, cuentaId: claveOf } });
  });
  d.sprint.forEach(x => {
    if (claves.has(claveCuenta(x.cuenta)) && x.cuenta !== oficial)
      cambios.push({ col: "cuentasSprint", id: x.id, datos: { cuenta: oficial } });
  });
  // Fichas: se juntan en una sola con id = llave del nombre oficial
  const fichas = d.fichas.filter(f => claves.has(claveCuenta(f.nombre || f.id)) || claves.has(f.id));
  const contactos = [];
  fichas.forEach(f => (f.contactos || []).forEach(ct => {
    if (ct?.nombre && !contactos.some(y => claveCuenta(y.nombre) === claveCuenta(ct.nombre))) contactos.push(ct);
  }));
  const principal = fichas.find(f => f.id === claveOf) || fichas.find(f => claveCuenta(f.nombre) === claveOf) || fichas[0];
  const segmento = segmentoDeRegistro(principal) || fichas.map(segmentoDeRegistro).find(Boolean) || cuentaDe(oficial)?.segmento || "";
  const nueva = { nombre: oficial, contactos, segmento };
  if (principal?.creadoPor) nueva.creadoPor = principal.creadoPor;
  if (fichas.length || segmento) cambios.push({ col: "cuentas", id: claveOf, crear: nueva });
  fichas.filter(f => f.id !== claveOf).forEach(f => cambios.push({ col: "cuentas", id: f.id, borrar: true }));
  return cambios;
}

async function aplicar(cambios, resumen) {
  if (!cambios.length) { toast("No hay nada que cambiar"); return false; }
  const cuenta = (col) => cambios.filter(c => c.col === col && !c.borrar).length;
  const txt = `${resumen}\n\nSe actualizarán: ${cuenta("deals")} oportunidad(es), ${cuenta("gestiones")} gestión(es), ` +
    `${cuenta("cuentasSprint")} cuenta(s) del Sprint, ${cuenta("cuentas")} ficha(s), ${cuenta("brokers")} broker(s)` +
    `${cambios.some(c => c.borrar) ? ` y se borrarán ${cambios.filter(c => c.borrar).length} ficha(s) repetida(s)` : ""}.\n\n¿Aplicar?`;
  if (!confirm(txt)) return false;
  ocupado = true;
  const res = await aplicarCambiosLote(cambios);
  ocupado = false;
  if (!res.ok) {
    alert(`Se aplicaron ${res.aplicados || 0} de ${cambios.length} cambios.\n\n${res.error}\n\nToma una captura de este mensaje para revisarlo.`);
    setTimeout(render, 400);
    return false;
  }
  toast(`✓ ${cambios.length} cambio(s) aplicados`);
  setTimeout(render, 400);
  return true;
}

// ── 2. Segmento de cuentas ──
function htmlSeg(g) {
  const lista = g.sinSegmento.sort((a, b) => (b.nDeals + b.nGestiones) - (a.nDeals + a.nGestiones));
  return `
    <div class="cd-intro">Cada cuenta tiene un solo segmento: <b>Retail, Corporativo o Público</b>. Se guarda en la ficha de la cuenta y lo usan Pipeline, Agenda y Sprint. Los datos viejos se traducen solos: Sector Público → Público; si no, su canal Retail/Corporativo.</div>
    ${g.sinFicha.length ? `<div class="cd-grupo"><h5><span>${g.sinFicha.length} cuenta(s) del histórico sin ficha en la base</span></h5>
      <div style="font-size:12px;color:var(--txt2)">Se crea la ficha con el nombre oficial y el segmento que ya se conoce. Así el formulario de oportunidades las muestra como cuentas de la base.</div>
      <div class="cd-acc"><button id="cd-crear-fichas">Crear las ${g.sinFicha.length} fichas</button></div></div>` : ""}
    <div class="cd-sub">Cuentas sin segmento (${lista.length})</div>
    ${lista.length ? `<table class="cd-tbl"><thead><tr><th>Cuenta</th><th>Uso</th><th>Segmento</th></tr></thead><tbody>
      ${lista.slice(0, 150).map((c, i) => `<tr><td><b>${esc(c.nombre)}</b></td><td style="color:var(--txt3)">${fuentes(c)}</td>
        <td><select class="form-select cd-seg" data-i="${i}"><option value="">—</option>${SEGMENTOS.map(s => `<option value="${s}">${SEGMENTO_TXT[s]}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table>
    <div class="cd-acc"><button id="cd-seg-ok">Guardar segmentos elegidos</button></div>
    ${lista.length > 150 ? `<div class="cd-intro" style="margin-top:8px">Mostrando 150 de ${lista.length}. Guarda y aparecerán las siguientes.</div>` : ""}`
    : `<div class="cd-vacio">✓ Todas las cuentas tienen segmento.</div>`}`;
}

// ── 3. Valores de campos ──
function htmlVal(g) {
  const bloques = Object.entries(g.campos).map(([k, def]) => {
    const l = g.valores[k];
    if (!l.length) return `<div class="cd-sub">${def.t}</div><div class="cd-vacio">✓ Todo dentro de la lista (${def.ops.join(", ")}).</div>`;
    return `<div class="cd-sub">${def.t} · ${l.length} valor(es) fuera de la lista</div>
      <table class="cd-tbl"><thead><tr><th>Escrito como</th><th>Registros</th><th>Pasar a</th></tr></thead><tbody>
      ${l.map(([raw, n]) => {
        const sug = def.norm(raw);
        // En el histórico el canal a veces traía el segmento ("Retail"): se vacía y pasa a Segmento
        const esSegmento = k === "canal" && !sug && normSegmento(raw);
        return `<tr><td>“${esc(raw)}”${esSegmento ? ` <small style="color:var(--txt3)">(es un segmento: pasa a Segmento)</small>` : ""}</td><td>${n}</td><td><select class="form-select cd-map" data-campo="${k}" data-raw="${esc(raw)}">
          <option value="">— no cambiar —</option>
          <option value="__vacio__" ${esSegmento ? "selected" : ""}>(dejar vacío)</option>
          ${def.ops.map(o => `<option value="${o}" ${o === sug ? "selected" : ""}>${o}</option>`).join("")}
        </select></td></tr>`;
      }).join("")}</tbody></table>`;
  }).join("");
  return `
    <div class="cd-intro">Traduce lo que se escribió a mano en las oportunidades a las listas cerradas. Ya viene una sugerencia cuando el texto es claro; revisa y aplica. Paso recomendado primero: completar el segmento.</div>
    ${g.segCompletables.length ? `<div class="cd-grupo"><h5><span>${g.segCompletables.length} oportunidad(es) sin segmento que se pueden completar</span></h5>
      <div style="font-size:12px;color:var(--txt2)">Con el segmento escrito en el campo canal (histórico) o el de su cuenta.</div>
      <div class="cd-acc"><button id="cd-seg-deals">Completar segmento</button></div></div>` : ""}
    ${g.canalCompletables.length ? `<div class="cd-grupo"><h5><span>${g.canalCompletables.length} oportunidad(es) con broker y sin canal</span></h5>
      <div class="cd-acc"><button id="cd-canal-ind">Marcarlas como canal Indirecto · origen Broker</button></div></div>` : ""}
    ${bloques}
    <div class="cd-acc" style="margin-top:14px"><button id="cd-val-ok">Aplicar las traducciones elegidas</button></div>`;
}

// ── 4. Brokers ──
function htmlBk(g) {
  const opts = listaBrokers().map(b => `<option value="${esc(b.nombre)}">${esc(b.nombre)}</option>`).join("");
  return `
    <div class="cd-intro">Brokers escritos a mano en oportunidades que no coinciden con el catálogo. Créalos en el catálogo o únelos con uno que ya existe; las oportunidades quedan con el nombre exacto del catálogo.</div>
    ${g.brokersPend.length ? `<div class="cd-acc" style="margin-bottom:10px"><button id="cd-bk-todos">Crear todos los que faltan y corregir escrituras</button></div>
      <table class="cd-tbl"><thead><tr><th>Escrito como</th><th>Registros</th><th>Acción</th></tr></thead><tbody>
      ${g.brokersPend.map((b, i) => `<tr><td>${Object.keys(b.variantes).map(v => `“${esc(v)}”`).join(", ")}</td><td>${b.n}</td>
        <td>${b.cat ? `<button class="cd-btn" data-bk-fix="${i}">Corregir a “${esc(b.cat.nombre)}”</button>`
          : `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="cd-btn" data-bk-crear="${i}">Crear “${esc(b.nombre)}”</button>
             ${opts ? `<select class="form-select cd-bk-sel" data-i="${i}" style="max-width:200px"><option value="">o unir con…</option>${opts}</select>` : ""}</div>`}</td></tr>`).join("")}
      </tbody></table>` : `<div class="cd-vacio">✓ Todos los brokers de las oportunidades están en el catálogo.</div>`}`;
}

function cambiosBroker(b, destino, crear) {
  const d = datosCatalogo();
  const k = claveCuenta(b.nombre);
  const cambios = [];
  if (crear) cambios.push({ col: "brokers", id: claveCuenta(destino), crear: { nombre: destino, empresa: "", contacto: "", correo: "", telefono: "", notas: "", creadoPor: "Gerencia" } });
  d.deals.forEach(x => {
    if (String(x.broker || "").trim() && claveCuenta(x.broker) === k && (x.broker !== destino || x.brokerId !== claveCuenta(destino)))
      cambios.push({ col: "deals", id: x.id, datos: { broker: destino, brokerId: claveCuenta(destino) } });
  });
  return cambios;
}

// ═══════════════════════════════════════════
// ACCIONES
// ═══════════════════════════════════════════
function activar(g) {
  const body = $("cd-body");
  const on = (sel, fn) => body.querySelectorAll(sel).forEach(el => el.addEventListener("click", () => fn(el)));

  // Duplicados
  on("[data-unificar]", async (el) => {
    const c = g.dups[parseInt(el.dataset.unificar)];
    const oficial = body.querySelector(`input[name="cd-of-${el.dataset.unificar}"]:checked`)?.value || c.nombre;
    await aplicar(cambiosUnificar(oficial, Object.keys(c.variantes)), `Unificar “${c.nombre}” como “${oficial}”.`);
  });
  const todas = $("cd-dup-todas");
  if (todas) todas.addEventListener("click", async () => {
    const cambios = g.dups.flatMap(c => cambiosUnificar(c.nombre, Object.keys(c.variantes)));
    await aplicar(cambios, `Unificar ${g.dups.length} cuenta(s) con el nombre sugerido.`);
  });
  on("[data-par]", async (el) => {
    const x = g.parecidas[parseInt(el.dataset.par)];
    const dest = el.dataset.dest === "a" ? x.a : x.b, otra = el.dataset.dest === "a" ? x.b : x.a;
    await aplicar(cambiosUnificar(dest.nombre, [...Object.keys(dest.variantes), ...Object.keys(otra.variantes)]), `Unir “${otra.nombre}” en “${dest.nombre}”.`);
  });
  on("[data-ignorar]", (el) => { ignorados.add(el.dataset.ignorar); render(); });
  const man = $("cd-man-ok");
  if (man) man.addEventListener("click", async () => {
    const a = cuentaDe($("cd-man-a").value), b = cuentaDe($("cd-man-b").value);
    if (!a || !b) { toast("Elige las dos cuentas de la lista"); return; }
    if (a.clave === b.clave) { toast("Es la misma cuenta"); return; }
    await aplicar(cambiosUnificar(b.nombre, [...Object.keys(a.variantes), ...Object.keys(b.variantes)]), `Unir “${a.nombre}” en “${b.nombre}”.`);
  });

  // Segmento de cuentas
  const cf = $("cd-crear-fichas");
  if (cf) cf.addEventListener("click", async () => {
    const cambios = g.sinFicha.map(c => ({ col: "cuentas", id: c.clave, crear: { nombre: c.nombre, segmento: c.segmento || "", contactos: [], creadoPor: "Gerencia", origen: "Calidad de datos · histórico" } }));
    await aplicar(cambios, `Crear ${cambios.length} ficha(s) de cuentas del histórico.`);
  });
  const so = $("cd-seg-ok");
  if (so) so.addEventListener("click", async () => {
    const lista = g.sinSegmento.sort((a, b) => (b.nDeals + b.nGestiones) - (a.nDeals + a.nGestiones));
    const cambios = [];
    body.querySelectorAll(".cd-seg").forEach(sel => {
      if (!sel.value) return;
      const c = lista[parseInt(sel.dataset.i)];
      const id = c.fichaId || c.clave;
      cambios.push({ col: "cuentas", id, crear: c.fichaId ? { segmento: sel.value } : { nombre: c.nombre, segmento: sel.value, contactos: [], creadoPor: "Gerencia", origen: "Calidad de datos" } });
    });
    await aplicar(cambios, "Guardar el segmento de las cuentas elegidas.");
  });

  // Valores
  const sd = $("cd-seg-deals");
  if (sd) sd.addEventListener("click", async () => {
    await aplicar(g.segCompletables.map(y => ({ col: "deals", id: y.x.id, datos: { segmento: y.seg } })), "Completar el segmento de las oportunidades.");
  });
  const ci = $("cd-canal-ind");
  if (ci) ci.addEventListener("click", async () => {
    await aplicar(g.canalCompletables.map(x => ({ col: "deals", id: x.id, datos: { canal: "Indirecto", origen: "Broker" } })), "Marcar como canal Indirecto las oportunidades con broker.");
  });
  const vo = $("cd-val-ok");
  if (vo) vo.addEventListener("click", async () => {
    const mapa = {};
    body.querySelectorAll(".cd-map").forEach(sel => {
      if (!sel.value) return;
      (mapa[sel.dataset.campo] = mapa[sel.dataset.campo] || {})[sel.dataset.raw] = sel.value === "__vacio__" ? "" : sel.value;
    });
    const porDeal = {};
    datosCatalogo().deals.forEach(x => Object.entries(mapa).forEach(([campo, m]) => {
      const raw = String(x[campo] ?? "").trim();
      if (!(raw in m)) return;
      const cambio = porDeal[x.id] = porDeal[x.id] || {};
      cambio[campo] = m[raw];
      // Si el canal traía el segmento, no se pierde: pasa al campo segmento
      if (campo === "canal" && normSegmento(raw) && !SEGMENTOS.includes(String(x.segmento || "").trim()) && !mapa.segmento)
        cambio.segmento = normSegmento(raw);
    }));
    await aplicar(Object.entries(porDeal).map(([id, datos]) => ({ col: "deals", id, datos })), "Traducir los valores elegidos a las listas cerradas.");
  });

  // Brokers
  on("[data-bk-crear]", async (el) => {
    const b = g.brokersPend[parseInt(el.dataset.bkCrear)];
    await aplicar(cambiosBroker(b, b.nombre, true), `Crear el broker “${b.nombre}”.`);
  });
  on("[data-bk-fix]", async (el) => {
    const b = g.brokersPend[parseInt(el.dataset.bkFix)];
    await aplicar(cambiosBroker(b, b.cat.nombre, false), `Corregir las oportunidades a “${b.cat.nombre}”.`);
  });
  body.querySelectorAll(".cd-bk-sel").forEach(sel => sel.addEventListener("change", async () => {
    if (!sel.value) return;
    const b = g.brokersPend[parseInt(sel.dataset.i)];
    const ok = await aplicar(cambiosBroker(b, sel.value, false), `Unir “${b.nombre}” con el broker “${sel.value}”.`);
    if (!ok) sel.value = "";
  }));
  const bt = $("cd-bk-todos");
  if (bt) bt.addEventListener("click", async () => {
    const cambios = g.brokersPend.flatMap(b => b.cat ? cambiosBroker(b, b.cat.nombre, false) : cambiosBroker(b, b.nombre, true));
    await aplicar(cambios, `Crear ${g.brokersPend.filter(b => !b.cat).length} broker(s) y corregir escrituras.`);
  });
}
