// ═══════════════════════════════════════════════════════════
// cuentas-acciones.js — v1.0 (nov 2026) · SOLO GERENCIA
// Arma las listas de cambios para corregir cuentas. No escribe nada:
// devuelve [{ col, id, datos | crear | borrar }] para aplicarCambiosLote().
// La usan 🧹 Calidad de datos y ✏️ Editar cuenta, así las dos
// herramientas corrigen exactamente igual.
// ═══════════════════════════════════════════════════════════

import { claveCuenta, segmentoDeRegistro } from "./catalogos.js";
import { datosCatalogo, cuentaDe } from "./cuentas-store.js";

const enClaves = (claves) => (x) => String(x.cuenta || "").trim() && claves.has(claveCuenta(x.cuenta));

// Deja todas las escrituras de `nombres` como UNA cuenta llamada `oficial`
// (oportunidades, gestiones, Sprint y fichas; los contactos se juntan).
// Sirve también para RENOMBRAR: cambiosUnificar(nombreNuevo, variantesActuales).
export function cambiosUnificar(oficial, nombres) {
  const d = datosCatalogo();
  const claves = new Set([oficial, ...nombres].map(claveCuenta));
  const claveOf = claveCuenta(oficial);
  const cambios = [];
  d.deals.filter(enClaves(claves)).forEach(x => {
    if (x.cuenta !== oficial || x.cuentaId !== claveOf)
      cambios.push({ col: "deals", id: x.id, datos: { cuenta: oficial, cuentaId: claveOf } });
  });
  d.gestionesTodas.filter(enClaves(claves)).forEach(x => {
    if (x.cuenta !== oficial || x.cuentaId !== claveOf)
      cambios.push({ col: "gestiones", id: x.id, datos: { cuenta: oficial, cuentaId: claveOf } });
  });
  d.sprint.filter(enClaves(claves)).forEach(x => {
    if (x.cuenta !== oficial) cambios.push({ col: "cuentasSprint", id: x.id, datos: { cuenta: oficial } });
  });
  // Fichas: se juntan en una sola con id = llave del nombre oficial
  const fichas = d.fichas.filter(f => claves.has(claveCuenta(f.nombre || f.id)) || claves.has(f.id));
  const contactos = [];
  fichas.forEach(f => (f.contactos || []).forEach(ct => {
    if (ct?.nombre && !contactos.some(y => claveCuenta(y.nombre) === claveCuenta(ct.nombre))) contactos.push(ct);
  }));
  const ocultos = [...new Set(fichas.flatMap(f => f.contactosOcultos || []))];
  const principal = fichas.find(f => f.id === claveOf) || fichas.find(f => claveCuenta(f.nombre) === claveOf) || fichas[0];
  const segmento = segmentoDeRegistro(principal) || fichas.map(segmentoDeRegistro).find(Boolean) || cuentaDe(oficial)?.segmento || "";
  const nueva = { nombre: oficial, contactos, segmento };
  if (ocultos.length) nueva.contactosOcultos = ocultos;
  if (principal?.creadoPor) nueva.creadoPor = principal.creadoPor;
  if (fichas.length || segmento) cambios.push({ col: "cuentas", id: claveOf, crear: nueva });
  fichas.filter(f => f.id !== claveOf).forEach(f => cambios.push({ col: "cuentas", id: f.id, borrar: true }));
  return cambios;
}

// Registros que pertenecen a una cuenta (todas sus escrituras)
export function registrosDeCuenta(clave) {
  const d = datosCatalogo();
  const es = (x) => String(x.cuenta || "").trim() && claveCuenta(x.cuenta) === clave;
  return {
    deals: d.deals.filter(es),
    gestiones: d.gestionesTodas.filter(es),
    sprint: d.sprint.filter(es),
    fichas: d.fichas.filter(f => f.id === clave || claveCuenta(f.nombre || f.id) === clave)
  };
}

// Mueve registros elegidos a otra cuenta (existente o nueva).
// sel = { deals: [ids], gestiones: [ids], sprint: [ids] }
// destino = nombre escrito; segmento = para crear la ficha si no existe;
// broker = { nombre, crear } opcional → las oportunidades movidas quedan Indirecto · Broker
export function cambiosMover(sel, destino, { segmento = "", broker = null } = {}) {
  const dest = cuentaDe(destino);
  const nombre = dest ? dest.nombre : String(destino).trim().replace(/\s+/g, " ");
  const clave = claveCuenta(nombre);
  const cambios = [];
  const datosBroker = broker ? { broker: broker.nombre, brokerId: claveCuenta(broker.nombre), canal: "Indirecto", origen: "Broker" } : {};
  if (broker?.crear) cambios.push({ col: "brokers", id: claveCuenta(broker.nombre), crear: { nombre: broker.nombre, empresa: "", contacto: "", correo: "", telefono: "", notas: "", creadoPor: "Gerencia" } });
  (sel.deals || []).forEach(id => cambios.push({ col: "deals", id, datos: { cuenta: nombre, cuentaId: clave, ...datosBroker } }));
  (sel.gestiones || []).forEach(id => cambios.push({ col: "gestiones", id, datos: { cuenta: nombre, cuentaId: clave } }));
  (sel.sprint || []).forEach(id => cambios.push({ col: "cuentasSprint", id, datos: { cuenta: nombre } }));
  // La cuenta destino debe existir en la base: si no tiene ficha, se crea
  if (!dest?.fichaId) {
    cambios.push({ col: "cuentas", id: clave, crear: { nombre, segmento: dest?.segmento || segmento || "", contactos: [], creadoPor: "Gerencia", origen: "Editar cuenta" } });
  }
  return cambios;
}

// Asigna (o crea y asigna) un broker a oportunidades, sin moverlas de cuenta
export function cambiosAsignarBroker(dealIds, broker) {
  const cambios = [];
  if (broker.crear) cambios.push({ col: "brokers", id: claveCuenta(broker.nombre), crear: { nombre: broker.nombre, empresa: "", contacto: "", correo: "", telefono: "", notas: "", creadoPor: "Gerencia" } });
  dealIds.forEach(id => cambios.push({ col: "deals", id, datos: { broker: broker.nombre, brokerId: claveCuenta(broker.nombre), canal: "Indirecto", origen: "Broker" } }));
  return cambios;
}
