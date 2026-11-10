// ═══════════════════════════════════════════════════════════
// cuentas-store.js — v1.0 (nov 2026)
// Catálogo VIVO de cuentas y brokers, compartido por Pipeline,
// Ficha de cuenta y la herramienta de Calidad de datos.
//
// Una "cuenta" junta todo lo que tiene la misma llave (claveCuenta):
//   ficha (colección cuentas) + oportunidades + gestiones + base instalada.
// Así "Laboratorios Provet SAS" y "LABORATORIOS PROVET SA" son UNA sola.
//
// Uso:
//   const quitar = alCambiarCatalogo(() => …);   // arranca las suscripciones
//   cuentaDe("laboratorios provet sa")  → { clave, nombre, segmento, … } | null
//   listaCuentas()  · brokers()  · brokerDe(nombre)
// ═══════════════════════════════════════════════════════════

import {
  suscribirCuentas, suscribirBrokers, suscribirCuentasSprint, suscribirGestiones, suscribirDeals
} from "./firestore-service.js";
import { claveCuenta, nombrePreferido, segmentoDeRegistro, normSegmento } from "./catalogos.js";

const REPS_EXCLUIDOS = ["elizabeth"];
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const excluido = (rep) => REPS_EXCLUIDOS.includes(plano(rep).split(/\s+/)[0]);

// gestionesTodas incluye las de reps retirados (para corregir datos);
// gestiones es lo que se muestra.
const datos = { fichas: [], brokers: [], sprint: [], gestiones: [], gestionesTodas: [], deals: [] };
const cargado = { fichas: false, brokers: false, sprint: false, gestiones: false, deals: false };
let paradas = [];
let indice = new Map();      // clave → cuenta
let indiceBrokers = new Map();
const oyentes = new Set();
let pendiente = null;

function iniciar() {
  if (paradas.length) return;
  const tomar = (k) => (lista) => { datos[k] = lista; cargado[k] = true; programar(); };
  paradas = [
    suscribirCuentas(tomar("fichas"), () => { cargado.fichas = true; programar(); }),
    suscribirBrokers(tomar("brokers"), () => { cargado.brokers = true; programar(); }),
    suscribirCuentasSprint(tomar("sprint"), () => { cargado.sprint = true; programar(); }),
    suscribirGestiones((l) => { datos.gestionesTodas = l; tomar("gestiones")(l.filter(g => !excluido(g.rep))); }, () => {}),
    suscribirDeals(tomar("deals"), () => {})
  ];
}
// Junta varias actualizaciones seguidas en un solo recálculo
function programar() {
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    reconstruir();
    oyentes.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }, 30);
}

export function alCambiarCatalogo(fn) {
  iniciar();
  oyentes.add(fn);
  if (indice.size || datos.fichas.length) setTimeout(fn, 0);
  return () => oyentes.delete(fn);
}
export function detenerCatalogo() {
  paradas.forEach(p => { try { p && p(); } catch (e) { /* nada */ } });
  paradas = [];
  oyentes.clear();
  Object.keys(datos).forEach(k => { datos[k] = []; cargado[k] = false; });
  indice = new Map(); indiceBrokers = new Map();
}
export function datosCatalogo() { return datos; }

function reconstruir() {
  const m = new Map();
  const tomar = (nombre) => {
    const n = String(nombre || "").trim();
    if (!n) return null;
    const k = claveCuenta(n);
    if (!m.has(k)) m.set(k, { clave: k, nombre: "", variantes: {}, fichas: [], segmento: "", nDeals: 0, nGestiones: 0, enSprint: false, ultima: "" });
    const c = m.get(k);
    c.variantes[n] = (c.variantes[n] || 0) + 1;
    return c;
  };
  datos.fichas.forEach(f => {
    const c = tomar(f.nombre || f.id);
    if (!c) return;
    c.fichas.push(f);
    if (!c.segmento) c.segmento = segmentoDeRegistro(f);
  });
  datos.deals.forEach(d => {
    const c = tomar(d.cuenta);
    if (!c) return;
    c.nDeals++;
  });
  [...datos.gestiones].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""))).forEach(g => {
    const c = tomar(g.cuenta);
    if (!c) return;
    c.nGestiones++;
    if (!c.ultima) c.ultima = g.fecha || "";
    if (!c.segmento) c.segmento = segmentoDeRegistro(g);
  });
  // Segmento desde el pipeline si nada más lo dice
  datos.deals.forEach(d => {
    const c = m.get(claveCuenta(d.cuenta));
    if (c && !c.segmento) c.segmento = normSegmento(d.segmento) || normSegmento(d.canal);
  });
  datos.sprint.forEach(s => { const c = tomar(s.cuenta); if (c) c.enSprint = true; });
  m.forEach(c => {
    // Nombre oficial: el de la ficha; si no hay, la escritura más usada
    c.ficha = c.fichas.find(f => f.id === c.clave) || c.fichas[0] || null;
    c.fichaId = c.ficha ? c.ficha.id : null;
    c.nombre = c.ficha?.nombre || nombrePreferido(c.variantes);
  });
  indice = m;

  const b = new Map();
  datos.brokers.forEach(x => b.set(claveCuenta(x.nombre || x.id), x));
  indiceBrokers = b;
}

// ── Consultas ──
export function catalogoListo() { return cargado.fichas && cargado.deals; }
export function cuentaDe(nombre) { return nombre ? indice.get(claveCuenta(nombre)) || null : null; }
export function nombreOficial(nombre) { return cuentaDe(nombre)?.nombre || String(nombre || "").trim(); }
export function listaCuentas() {
  return [...indice.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
export function brokers() {
  return [...datos.brokers].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
}
export function brokerDe(nombre) { return nombre ? indiceBrokers.get(claveCuenta(nombre)) || null : null; }
// Cuentas escritas de varias formas o con más de una ficha
export function cuentasConVariantes() {
  return [...indice.values()].filter(c => Object.keys(c.variantes).length > 1 || c.fichas.length > 1);
}
