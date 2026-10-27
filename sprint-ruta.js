// ═══════════════════════════════════════════════════════════
// sprint-ruta.js — v1 (oct 2026)
// Lógica ÚNICA de la ruta de contacto (Día 1 · 2 · 5 · 8 · 12).
// La usan sprint-view.js y sprint-cuentas.js para que las dos
// tablas calculen igual el siguiente paso y los vencimientos.
//
// Reglas:
//  · El siguiente paso es el que sigue al ÚLTIMO paso hecho. Si un
//    comercial hizo el Día 2 sin el Día 1, el Día 1 queda "saltado"
//    y no bloquea la ruta.
//  · Antes del primer paso, la fecha la pone el plan (planDia1).
//  · Después, cada paso vence contando días HÁBILES desde la fecha
//    real del último paso (Día 1→2: 1 día, 2→5: 3, 5→8: 3, 8→12: 4).
//    Así un atraso no deja vencidos todos los pasos siguientes.
// ═══════════════════════════════════════════════════════════

import { SPRINT, PASOS_RUTA } from "./sprint-config.js";

const NUM = PASOS_RUTA.map(p => parseInt(p.match(/\d+/)[0], 10)); // [1, 2, 5, 8, 12]
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
export const hoyISO = () => iso(new Date());

export function normCuenta(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Suma n días hábiles (sin sábados, domingos ni festivos del sprint).
export function sumarHabiles(fecha, n) {
  const d = parse(fecha);
  let k = 0;
  while (k < n) {
    d.setDate(d.getDate() + 1);
    const s = iso(d);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !SPRINT.festivos.includes(s)) k++;
  }
  return iso(d);
}

// Agrupa las gestiones "Paso de la ruta" del sprint por cuenta.
// Devuelve Map(normCuenta → { cuenta, rep, pasos: Map(paso → fecha), dec: Set, ultimo })
export function agruparRuta(gestiones) {
  const m = new Map();
  for (const g of gestiones) {
    if (g.sprintAccion !== "ruta" || !g.fecha || g.fecha < SPRINT.inicio || g.fecha > SPRINT.fin) continue;
    if (!PASOS_RUTA.includes(g.sprintPaso)) continue;
    const k = normCuenta(g.cuenta);
    if (!m.has(k)) m.set(k, { cuenta: g.cuenta, rep: g.rep, pasos: new Map(), dec: new Set(), ultimo: "" });
    const a = m.get(k);
    if (!a.pasos.has(g.sprintPaso) || g.fecha > a.pasos.get(g.sprintPaso)) a.pasos.set(g.sprintPaso, g.fecha);
    if (g.sprintDecisor) a.dec.add(g.sprintPaso);
    if (g.fecha > a.ultimo) { a.ultimo = g.fecha; a.rep = g.rep; }
  }
  return m;
}

// Estado de la ruta de una cuenta.
//   av        → elemento de agruparRuta() (o undefined si no hay pasos)
//   planDia1  → fecha planeada del Día 1 (puede ir vacía)
// Devuelve { codigo, idx, vence, hechos:Set, saltados:Set, dec:Set, ultimo }
//   codigo: "pendiente" | "curso" | "hoy" | "vencido" | "completa"
export function estadoRuta(av, planDia1) {
  const hechos = new Set(av ? av.pasos.keys() : []);
  const dec = av?.dec || new Set();
  let ultimoIdx = -1;
  PASOS_RUTA.forEach((p, i) => { if (hechos.has(p)) ultimoIdx = i; });
  const saltados = new Set(PASOS_RUTA.filter((p, i) => i < ultimoIdx && !hechos.has(p)));
  if (ultimoIdx === PASOS_RUTA.length - 1) {
    return { codigo: "completa", idx: -1, vence: "", hechos, saltados, dec, ultimo: av?.ultimo || "" };
  }
  const idx = ultimoIdx + 1;
  const vence = ultimoIdx === -1
    ? (planDia1 || "")
    : sumarHabiles(av.pasos.get(PASOS_RUTA[ultimoIdx]), NUM[idx] - NUM[ultimoIdx]);
  const t = hoyISO();
  let codigo = ultimoIdx === -1 ? "pendiente" : "curso";
  if (vence && vence < t) codigo = "vencido";
  else if (vence && vence === t) codigo = "hoy";
  return { codigo, idx, vence, hechos, saltados, dec, ultimo: av?.ultimo || "" };
}

// Círculos de la ruta: azul = hecho · borde verde = con decisor · punteado = saltado.
export function pasosHtml(r) {
  return `<div class="sp-pasos">${PASOS_RUTA.map((p, i) => {
    const cls = r.hechos.has(p) ? " ok" : r.saltados.has(p) ? " salt" : "";
    const tit = r.saltados.has(p) ? `${p} (saltado)` : p;
    return `<span class="sp-paso${cls}${r.dec.has(p) ? " dec" : ""}" title="${tit}">${NUM[i]}</span>`;
  }).join("")}</div>`;
}
