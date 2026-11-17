// ═══════════════════════════════════════════════════════════
// agenda-calendario.js — v1.0 (nov 2026)
// 📅 Vista de CALENDARIO de la Agenda, estilo Outlook:
//   · Día · Semana laboral (L–V) · Semana (L–D) · Mes
//   · Rejilla de horas con bloques del tamaño de su duración
//     (campo `duracion` en minutos; las gestiones viejas = 60 min)
//   · Gestiones sin hora → franja "Sin hora" arriba
//   · Clic en un espacio vacío → registrar gestión con esa fecha y hora
//   · Clic en un bloque → abrir la gestión
//   · Arrastrar un bloque → moverla a otro día / hora (solo las propias;
//     Gerencia todas). Ajusta de a 15 minutos.
//   · Gerencia: un color por rep y filtro por rep
//
// Este módulo NO habla con Firebase: agenda-view.js le pasa los datos
// y le dice qué hacer con callbacks.
//   montarCalendario(contenedor, {
//     gestiones: () => [...],        // lista visible según el rol
//     reps: () => [...],             // nombres (solo Gerencia)
//     colorRep: (rep) => "#hex",
//     puedeEditar: (g) => bool,
//     esAdmin: bool,
//     etiquetaEtapa: (g) => "Seguimiento",
//     onNueva: (fecha, hora) => …,
//     onAbrir: (g) => …,
//     onMover: async (g, fecha, hora) => ({ ok, error })
//   })
//   refrescarCalendario()  → volver a pintar (cuando cambian los datos)
// ═══════════════════════════════════════════════════════════

const HORA_INI = 6, HORA_FIN = 21;        // rango visible
const PX_HORA = 52;                       // alto de una hora
const PX_MIN = PX_HORA / 60;
const PASO = 15;                          // minutos al arrastrar
const DUR_DEF = 60;
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

let cont = null, op = {};
let vista = "semanaLab";                  // dia | semanaLab | semana | mes
let ancla = new Date();                   // fecha de referencia
let repsOcultos = new Set();
let scrollInicial = true;
let arrastre = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deIso = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const minDe = (h) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || "")); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null; };
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const durDe = (g) => { const d = parseInt(g.duracion, 10); return d > 0 ? Math.min(d, 12 * 60) : DUR_DEF; };
function lunes(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function sumar(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// ═══════════════════════════════════════════
// MONTAJE
// ═══════════════════════════════════════════
export function montarCalendario(contenedor, opciones) {
  cont = contenedor; op = opciones;
  if (window.innerWidth < 700) vista = "dia";
  cont.innerHTML = `
    <style>
      .cal-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
      .cal-nav{display:flex;align-items:center;gap:4px;background:var(--surface);border:.5px solid var(--border);border-radius:99px;padding:3px 6px}
      .cal-nav button{background:none;border:none;font-size:14px;cursor:pointer;padding:4px 9px;border-radius:99px;font-family:inherit}
      .cal-nav button:hover{background:var(--s2)}
      .cal-hoy{padding:7px 12px!important;font-size:12px!important}
      .cal-titulo{font-size:15px;font-weight:700;margin-right:auto}
      .cal-titulo::first-letter{text-transform:uppercase}
      .cal-vistas{display:flex;background:var(--s2);border-radius:99px;padding:3px}
      .cal-vistas button{border:none;background:none;padding:6px 12px;border-radius:99px;font-size:12px;font-weight:600;color:var(--txt2);cursor:pointer;font-family:inherit}
      .cal-vistas button.on{background:var(--surface);color:var(--txt);box-shadow:0 1px 3px rgba(0,0,0,.12)}
      .cal-reps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
      .cal-rep{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;font-family:inherit;color:var(--txt)}
      .cal-rep i{width:10px;height:10px;border-radius:3px;display:inline-block}
      .cal-rep.off{opacity:.4;text-decoration:line-through}
      .cal-card{background:var(--surface);border:.5px solid var(--border);border-radius:var(--r);overflow:hidden}
      .cal-head{display:grid;border-bottom:.5px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:3}
      .cal-hd{padding:8px 4px;text-align:center;font-size:12px;color:var(--txt2);border-left:.5px solid var(--border);cursor:pointer}
      .cal-hd b{display:block;font-size:20px;color:var(--txt);font-weight:600;line-height:1.1}
      .cal-hd.hoy b{background:var(--blue);color:#fff;border-radius:99px;width:32px;height:32px;line-height:32px;margin:2px auto 0}
      .cal-hd.hoy{color:var(--blue);font-weight:700}
      .cal-sinhora{display:grid;border-bottom:.5px solid var(--border);min-height:28px}
      .cal-sinhora > div{border-left:.5px solid var(--border);padding:3px;display:flex;flex-direction:column;gap:2px}
      .cal-sinhora .lbl{font-size:10px;color:var(--txt3);text-align:right;padding:6px 6px 0 0;border-left:none}
      .cal-scroll{max-height:620px;overflow-y:auto;position:relative}
      .cal-grid{display:grid;position:relative}
      .cal-horas{position:relative}
      .cal-horas div{height:${PX_HORA}px;font-size:10px;color:var(--txt3);text-align:right;padding-right:6px;transform:translateY(-6px)}
      .cal-dia{position:relative;border-left:.5px solid var(--border);background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${PX_HORA / 2 - 1}px,rgba(0,0,0,.035) ${PX_HORA / 2 - 1}px,rgba(0,0,0,.035) ${PX_HORA / 2}px,transparent ${PX_HORA / 2}px,transparent ${PX_HORA - 1}px,rgba(0,0,0,.08) ${PX_HORA - 1}px,rgba(0,0,0,.08) ${PX_HORA}px);cursor:cell}
      .cal-dia.finde{background-color:rgba(0,0,0,.018)}
      .cal-dia.hoy{background-color:rgba(37,99,235,.035)}
      .cal-ev{position:absolute;border-radius:6px;padding:3px 6px;font-size:11px;line-height:1.25;overflow:hidden;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.12);border-left:3px solid rgba(0,0,0,.25);color:#fff;user-select:none;touch-action:none}
      .cal-ev:hover{filter:brightness(1.06);z-index:5}
      .cal-ev b{display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cal-ev span{display:block;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cal-ev.fijo{cursor:pointer}
      .cal-ev.arrastrando{opacity:.85;z-index:20;box-shadow:0 8px 20px rgba(0,0,0,.25)}
      .cal-chip{border-radius:5px;padding:2px 6px;font-size:11px;color:#fff;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none;touch-action:none}
      .cal-ahora{position:absolute;left:0;right:0;height:2px;background:#dc2626;z-index:6;pointer-events:none}
      .cal-ahora::before{content:"";position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:50%;background:#dc2626}
      .cal-fantasma{position:absolute;border:2px dashed var(--blue);border-radius:6px;background:rgba(37,99,235,.08);pointer-events:none;z-index:15;font-size:11px;font-weight:700;color:#1d4ed8;padding:2px 6px}
      .cal-mes{display:grid;grid-template-columns:repeat(7,1fr)}
      .cal-mes-h{padding:8px;font-size:11px;color:var(--txt2);text-align:center;border-bottom:.5px solid var(--border);font-weight:600}
      .cal-celda{min-height:108px;border-left:.5px solid var(--border);border-bottom:.5px solid var(--border);padding:4px;display:flex;flex-direction:column;gap:2px;cursor:cell;overflow:hidden}
      .cal-celda.fuera{background:rgba(0,0,0,.025)}
      .cal-celda.fuera .cal-num{color:var(--txt3)}
      .cal-celda.sobre{outline:2px dashed var(--blue);outline-offset:-2px}
      .cal-num{font-size:12px;font-weight:600;align-self:flex-end;cursor:pointer;padding:1px 6px;border-radius:99px}
      .cal-num:hover{background:var(--s2)}
      .cal-celda.hoy .cal-num{background:var(--blue);color:#fff}
      .cal-mas{font-size:11px;color:var(--blue);font-weight:600;cursor:pointer;padding:0 4px}
      .cal-tip{font-size:11px;color:var(--txt3);margin-top:8px}
      @media(max-width:700px){.cal-titulo{width:100%;order:-1}.cal-celda{min-height:70px}.cal-ev span{display:none}}
    </style>
    <div class="cal-bar">
      <div class="cal-nav"><button id="cal-prev" title="Anterior">◀</button><button class="cal-hoy" id="cal-hoy">Hoy</button><button id="cal-next" title="Siguiente">▶</button></div>
      <div class="cal-titulo" id="cal-titulo"></div>
      <div class="cal-vistas" id="cal-vistas">
        <button data-v="dia">Día</button><button data-v="semanaLab">Semana laboral</button><button data-v="semana">Semana</button><button data-v="mes">Mes</button>
      </div>
    </div>
    <div class="cal-reps" id="cal-reps"></div>
    <div class="cal-card" id="cal-cuerpo"></div>
    <div class="cal-tip">💡 Clic en un espacio vacío para registrar una gestión a esa hora · clic en una gestión para abrirla · arrástrala para cambiarle el día o la hora.</div>`;
  cont.querySelector("#cal-prev").addEventListener("click", () => mover(-1));
  cont.querySelector("#cal-next").addEventListener("click", () => mover(1));
  cont.querySelector("#cal-hoy").addEventListener("click", () => { ancla = new Date(); scrollInicial = true; pintar(); });
  cont.querySelectorAll("#cal-vistas [data-v]").forEach(b => b.addEventListener("click", () => { vista = b.dataset.v; scrollInicial = true; pintar(); }));
  pintar();
}

// Si llegan datos nuevos mientras se arrastra, se repinta al soltar
let pendiente = false;
export function refrescarCalendario() {
  if (!cont) return;
  if (arrastre) { pendiente = true; return; }
  pintar();
}

function mover(n) {
  if (vista === "dia") ancla = sumar(ancla, n);
  else if (vista === "mes") ancla = new Date(ancla.getFullYear(), ancla.getMonth() + n, 1);
  else ancla = sumar(ancla, 7 * n);
  pintar();
}

// ═══════════════════════════════════════════
// DATOS
// ═══════════════════════════════════════════
function visibles() {
  return (op.gestiones() || []).filter(g => g.fecha && !repsOcultos.has(g.rep));
}
function colorDe(g) {
  if (op.esAdmin) return op.colorRep(g.rep);
  return g.tipo === "Comercial" ? "#2563EB" : "#6b7280";
}
function textoEv(g) {
  return {
    t: g.cuenta || "(sin cuenta)",
    s: [g.oportunidad && g.oportunidad !== "Sin oportunidad" ? g.oportunidad : "", op.etiquetaEtapa(g) || g.tipo, op.esAdmin ? (g.rep || "").split(" ")[0] : ""].filter(Boolean).join(" · ")
  };
}
function titulo(g) {
  const ini = minDe(g.hora);
  return `${g.cuenta || ""}${g.oportunidad ? " — " + g.oportunidad : ""}\n${ini != null ? hhmm(ini) + "–" + hhmm(ini + durDe(g)) : "Sin hora"} · ${g.rep || ""} · ${g.tipo || ""}${g.modalidad ? " · " + g.modalidad : ""}${op.puedeEditar(g) ? "\n(arrastra para mover)" : ""}`;
}

// ═══════════════════════════════════════════
// PINTAR
// ═══════════════════════════════════════════
function pintar() {
  if (!cont) return;
  cont.querySelectorAll("#cal-vistas [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === vista));
  pintarReps();
  if (vista === "mes") pintarMes();
  else pintarSemana();
}

function pintarReps() {
  const el = cont.querySelector("#cal-reps");
  if (!op.esAdmin) { el.style.display = "none"; return; }
  el.innerHTML = op.reps().map(r => `<button class="cal-rep ${repsOcultos.has(r) ? "off" : ""}" data-rep="${esc(r)}" title="Mostrar / ocultar"><i style="background:${op.colorRep(r)}"></i>${esc(r.split(" ")[0])}</button>`).join("") +
    (repsOcultos.size ? `<button class="cal-rep" id="cal-todos">Ver todos</button>` : "");
  el.querySelectorAll("[data-rep]").forEach(b => b.addEventListener("click", () => {
    const r = b.dataset.rep;
    if (repsOcultos.has(r)) repsOcultos.delete(r); else repsOcultos.add(r);
    pintar();
  }));
  const t = el.querySelector("#cal-todos");
  if (t) t.addEventListener("click", () => { repsOcultos.clear(); pintar(); });
}

function diasVista() {
  if (vista === "dia") { const d = new Date(ancla); d.setHours(0, 0, 0, 0); return [d]; }
  const l = lunes(ancla);
  return Array.from({ length: vista === "semanaLab" ? 5 : 7 }, (_, i) => sumar(l, i));
}

// Reparte en columnas las gestiones que se cruzan en el tiempo
function layout(eventos) {
  eventos.sort((a, b) => a.ini - b.ini || b.fin - a.fin);
  const grupos = [];
  let grupo = [], finGrupo = -1;
  eventos.forEach(e => {
    if (e.ini >= finGrupo && grupo.length) { grupos.push(grupo); grupo = []; }
    grupo.push(e); finGrupo = Math.max(finGrupo, e.fin);
  });
  if (grupo.length) grupos.push(grupo);
  grupos.forEach(gr => {
    const cols = [];
    gr.forEach(e => {
      let c = cols.findIndex(fin => fin <= e.ini);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = e.fin; e.col = c;
    });
    gr.forEach(e => { e.ncols = cols.length; });
  });
  return eventos;
}

function pintarSemana() {
  const dias = diasVista();
  const hoy = iso(new Date());
  const t = cont.querySelector("#cal-titulo");
  if (vista === "dia") t.textContent = dias[0].toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  else {
    const a = dias[0], b = dias[dias.length - 1];
    t.textContent = a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} de ${MESES[a.getMonth()]} ${a.getFullYear()}`
      : `${a.getDate()} ${MESES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MESES[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
  }
  const cols = `52px repeat(${dias.length}, minmax(0,1fr))`;
  const lista = visibles();
  const porDia = {};
  dias.forEach(d => porDia[iso(d)] = { conHora: [], sinHora: [] });
  lista.forEach(g => {
    const p = porDia[g.fecha]; if (!p) return;
    const ini = minDe(g.hora);
    if (ini == null) p.sinHora.push(g);
    else p.conHora.push({ g, ini, fin: ini + durDe(g) });
  });
  const haySinHora = dias.some(d => porDia[iso(d)].sinHora.length);
  const altoTotal = (HORA_FIN - HORA_INI) * PX_HORA;

  cont.querySelector("#cal-cuerpo").innerHTML = `
    <div class="cal-head" style="grid-template-columns:${cols}">
      <div></div>
      ${dias.map(d => `<div class="cal-hd ${iso(d) === hoy ? "hoy" : ""}" data-ir="${iso(d)}" title="Ver el día">${DIAS[(d.getDay() + 6) % 7]}<b>${d.getDate()}</b></div>`).join("")}
    </div>
    ${haySinHora ? `<div class="cal-sinhora" style="grid-template-columns:${cols}"><div class="lbl">Sin hora</div>
      ${dias.map(d => `<div data-fecha="${iso(d)}">${porDia[iso(d)].sinHora.map(g => `<div class="cal-chip" data-id="${esc(g.id)}" style="background:${colorDe(g)}" title="${esc(titulo(g))}">${esc(g.cuenta || "")}</div>`).join("")}</div>`).join("")}</div>` : ""}
    <div class="cal-scroll" id="cal-scroll">
      <div class="cal-grid" style="grid-template-columns:${cols};height:${altoTotal}px">
        <div class="cal-horas">${Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => `<div>${i ? hhmm((HORA_INI + i) * 60) : ""}</div>`).join("")}</div>
        ${dias.map(d => {
          const k = iso(d);
          const evs = layout(porDia[k].conHora);
          const fin = (d.getDay() === 0 || d.getDay() === 6);
          return `<div class="cal-dia ${k === hoy ? "hoy" : ""} ${fin ? "finde" : ""}" data-fecha="${k}">
            ${evs.map(e => {
              const top = Math.max(0, (e.ini - HORA_INI * 60) * PX_MIN);
              const alto = Math.max(20, (Math.min(e.fin, HORA_FIN * 60) - Math.max(e.ini, HORA_INI * 60)) * PX_MIN - 2);
              const ancho = 100 / e.ncols;
              const tx = textoEv(e.g);
              return `<div class="cal-ev ${op.puedeEditar(e.g) ? "" : "fijo"}" data-id="${esc(e.g.id)}" title="${esc(titulo(e.g))}"
                style="top:${top}px;height:${alto}px;left:calc(${e.col * ancho}% + 2px);width:calc(${ancho}% - 4px);background:${colorDe(e.g)}">
                <b>${hhmm(e.ini)} ${esc(tx.t)}</b>${alto > 34 ? `<span>${esc(tx.s)}</span>` : ""}</div>`;
            }).join("")}
            ${k === hoy ? lineaAhora() : ""}
          </div>`;
        }).join("")}
      </div>
    </div>`;

  // Desplaza a las 7:00 (o a la hora actual si es hoy) la primera vez
  const sc = cont.querySelector("#cal-scroll");
  if (scrollInicial) {
    const ahora = new Date();
    const h = dias.some(d => iso(d) === hoy) ? Math.max(HORA_INI, ahora.getHours() - 2) : 7;
    sc.scrollTop = (h - HORA_INI) * PX_HORA;
    scrollInicial = false;
  }
  cont.querySelectorAll("[data-ir]").forEach(el => el.addEventListener("click", () => { ancla = deIso(el.dataset.ir); vista = "dia"; pintar(); }));
  // Clic en espacio vacío → nueva gestión a esa hora
  cont.querySelectorAll(".cal-dia").forEach(col => col.addEventListener("click", (e) => {
    if (e.target !== col || arrastre?.movido) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = Math.floor((HORA_INI * 60 + y / PX_MIN) / 30) * 30;
    op.onNueva(col.dataset.fecha, hhmm(Math.min(min, 23 * 60 + 30)));
  }));
  cont.querySelectorAll(".cal-sinhora [data-fecha]").forEach(c => c.addEventListener("click", (e) => { if (e.target === c) op.onNueva(c.dataset.fecha, ""); }));
  activarEventos(".cal-ev, .cal-chip");
}

function lineaAhora() {
  const a = new Date();
  const min = a.getHours() * 60 + a.getMinutes();
  if (min < HORA_INI * 60 || min > HORA_FIN * 60) return "";
  return `<div class="cal-ahora" style="top:${(min - HORA_INI * 60) * PX_MIN}px"></div>`;
}

function pintarMes() {
  const y = ancla.getFullYear(), m = ancla.getMonth();
  cont.querySelector("#cal-titulo").textContent = `${MESES[m]} ${y}`;
  const ini = lunes(new Date(y, m, 1));
  const ultimo = new Date(y, m + 1, 0);
  const semanas = Math.ceil(((ultimo - ini) / 86400000 + 1) / 7);
  const hoy = iso(new Date());
  const porDia = {};
  visibles().forEach(g => (porDia[g.fecha] = porDia[g.fecha] || []).push(g));
  Object.values(porDia).forEach(l => l.sort((a, b) => String(a.hora || "99").localeCompare(String(b.hora || "99"))));
  const max = window.innerWidth < 700 ? 2 : 4;
  let html = `<div class="cal-mes">${DIAS.map(d => `<div class="cal-mes-h">${d}</div>`).join("")}`;
  for (let i = 0; i < semanas * 7; i++) {
    const d = sumar(ini, i), k = iso(d);
    const l = porDia[k] || [];
    html += `<div class="cal-celda ${d.getMonth() !== m ? "fuera" : ""} ${k === hoy ? "hoy" : ""}" data-fecha="${k}">
      <span class="cal-num" data-ir="${k}">${d.getDate()}</span>
      ${l.slice(0, max).map(g => `<div class="cal-chip" data-id="${esc(g.id)}" style="background:${colorDe(g)}" title="${esc(titulo(g))}">${g.hora ? esc(g.hora) + " " : ""}${esc(g.cuenta || "")}</div>`).join("")}
      ${l.length > max ? `<span class="cal-mas" data-ir="${k}">+${l.length - max} más</span>` : ""}
    </div>`;
  }
  cont.querySelector("#cal-cuerpo").innerHTML = html + "</div>";
  cont.querySelectorAll("[data-ir]").forEach(el => el.addEventListener("click", (e) => { e.stopPropagation(); ancla = deIso(el.dataset.ir); vista = "dia"; scrollInicial = true; pintar(); }));
  cont.querySelectorAll(".cal-celda").forEach(c => c.addEventListener("click", (e) => { if (e.target === c && !arrastre?.movido) op.onNueva(c.dataset.fecha, "09:00"); }));
  activarEventos(".cal-chip");
}

// ═══════════════════════════════════════════
// CLIC Y ARRASTRE (ratón y pantalla táctil)
// ═══════════════════════════════════════════
function activarEventos(selector) {
  const lista = op.gestiones() || [];
  cont.querySelectorAll(selector).forEach(el => {
    const g = lista.find(x => x.id === el.dataset.id);
    if (!g) return;
    el.addEventListener("pointerdown", (e) => iniciarArrastre(e, el, g));
    el.addEventListener("click", (e) => { e.stopPropagation(); if (!arrastre?.movido) op.onAbrir(g); });
  });
}

function iniciarArrastre(e, el, g) {
  if (e.button !== 0 || !op.puedeEditar(g)) return;
  const enGrilla = el.classList.contains("cal-ev");
  const rect = el.getBoundingClientRect();
  arrastre = { g, el, enGrilla, x0: e.clientX, y0: e.clientY, dy: e.clientY - rect.top, movido: false, destino: null, fantasma: null };
  el.setPointerCapture(e.pointerId);
  const mov = (ev) => moverArrastre(ev);
  const fin = async (ev) => {
    el.removeEventListener("pointermove", mov);
    el.removeEventListener("pointerup", fin);
    el.removeEventListener("pointercancel", fin);
    const a = arrastre;
    if (a?.fantasma) a.fantasma.remove();
    cont.querySelectorAll(".cal-celda.sobre").forEach(c => c.classList.remove("sobre"));
    el.classList.remove("arrastrando");
    if (!a?.movido) { arrastre = null; if (pendiente) { pendiente = false; pintar(); } return; }
    // Deja "movido" activo un instante para que el clic posterior no abra la gestión
    setTimeout(() => { if (arrastre === a) arrastre = null; }, 0);
    if (ev.type === "pointercancel" || !a.destino) { pintar(); return; }
    const { fecha, hora } = a.destino;
    if (fecha === a.g.fecha && hora === (a.g.hora || "")) { pintar(); return; }
    await op.onMover(a.g, fecha, hora);
    if (arrastre === a) arrastre = null;
    pendiente = false;
    pintar();   // con los datos ya actualizados (o como estaba, si falló)
  };
  el.addEventListener("pointermove", mov);
  el.addEventListener("pointerup", fin);
  el.addEventListener("pointercancel", fin);
}

function moverArrastre(e) {
  const a = arrastre;
  if (!a) return;
  if (!a.movido && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 6) return;
  if (!a.movido) { a.movido = true; a.el.classList.add("arrastrando"); }
  // Día (o celda) bajo el puntero
  a.el.style.visibility = "hidden";
  const debajo = document.elementFromPoint(e.clientX, e.clientY);
  a.el.style.visibility = "";
  const col = debajo?.closest?.(".cal-dia, .cal-celda, .cal-sinhora [data-fecha]");
  cont.querySelectorAll(".cal-celda.sobre").forEach(c => c.classList.remove("sobre"));
  if (!col) { a.destino = null; if (a.fantasma) a.fantasma.style.display = "none"; return; }
  const fecha = col.dataset.fecha;
  if (col.classList.contains("cal-dia")) {
    const top = e.clientY - col.getBoundingClientRect().top - (a.enGrilla ? a.dy : 0);
    let min = Math.round((HORA_INI * 60 + top / PX_MIN) / PASO) * PASO;
    const dur = durDe(a.g);
    min = Math.max(HORA_INI * 60, Math.min(min, HORA_FIN * 60 - Math.min(dur, 60)));
    a.destino = { fecha, hora: hhmm(min) };
    if (!a.fantasma) { a.fantasma = document.createElement("div"); a.fantasma.className = "cal-fantasma"; }
    if (a.fantasma.parentElement !== col) col.appendChild(a.fantasma);
    Object.assign(a.fantasma.style, { display: "block", top: (min - HORA_INI * 60) * PX_MIN + "px", height: Math.max(20, dur * PX_MIN - 2) + "px", left: "2px", right: "2px" });
    a.fantasma.textContent = `${hhmm(min)} – ${hhmm(min + dur)}`;
  } else if (col.classList.contains("cal-celda")) {
    // Mes: cambia el día y conserva la hora
    col.classList.add("sobre");
    a.destino = { fecha, hora: a.g.hora || "" };
    if (a.fantasma) a.fantasma.style.display = "none";
  } else {
    // Franja "Sin hora"
    a.destino = { fecha, hora: "" };
    if (a.fantasma) a.fantasma.style.display = "none";
  }
}
