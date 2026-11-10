// ═══════════════════════════════════════════════════════════
// firestore-service.js
// ÚNICA capa que habla con la base de datos Cloud Firestore.
// Las vistas (pipeline, agenda) nunca importan Firestore
// directamente: usan estas funciones.
//
// Colecciones:
//   deals     → oportunidades del Pipeline 2026
//   gestiones → registros de la Agenda Comercial
//   cuentasSprint → cuentas de base instalada a recontactar (Sprint)
//   cuentas   → ficha única por cliente (segmento, contactos) — nov 2026
//   brokers   → catálogo de brokers (canal Indirecto) — nov 2026
//
// Todas las funciones de escritura devuelven { ok, error }.
// Las suscripciones entregan los datos EN VIVO: cada vez que
// alguien del equipo crea o edita algo, el callback se vuelve
// a ejecutar con la lista actualizada.
// ═══════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { claveCuenta } from "./catalogos.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ───────────────────────────────────────────────
// Suscripciones en tiempo real
// Uso:
//   const parar = suscribirDeals(function(lista){ ... });
//   // más tarde, para dejar de escuchar: parar();
// Cada elemento de la lista incluye su id de documento.
// ───────────────────────────────────────────────

export function suscribirDeals(callback, onError) {
  const q = query(collection(db, "deals"), orderBy("creadoEn", "desc"));
  return onSnapshot(q, (snap) => {
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(lista);
  }, (error) => {
    console.error("Error escuchando deals:", error);
    if (onError) onError(error);
  });
}

export function suscribirGestiones(callback, onError) {
  const q = query(collection(db, "gestiones"), orderBy("creadoEn", "desc"));
  return onSnapshot(q, (snap) => {
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(lista);
  }, (error) => {
    console.error("Error escuchando gestiones:", error);
    if (onError) onError(error);
  });
}

// ───────────────────────────────────────────────
// PIPELINE (colección: deals)
// Recuerda: por las reglas de Firestore, un vendedor solo
// puede crear/editar deals cuyo campo "rep" sea su nombreRep.
// ───────────────────────────────────────────────

export async function crearDeal(datos) {
  try {
    const ref = await addDoc(collection(db, "deals"), {
      ...datos,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error creando deal:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

export async function actualizarDeal(id, datos) {
  try {
    await updateDoc(doc(db, "deals", id), {
      ...datos,
      actualizadoEn: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    console.error("Error actualizando deal:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

export async function eliminarDeal(id) {
  try {
    await deleteDoc(doc(db, "deals", id));
    return { ok: true };
  } catch (error) {
    console.error("Error eliminando deal:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// AGENDA (colección: gestiones)
// ───────────────────────────────────────────────

export async function crearGestion(datos) {
  try {
    const ref = await addDoc(collection(db, "gestiones"), {
      ...datos,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error creando gestión:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

export async function actualizarGestion(id, datos) {
  try {
    await updateDoc(doc(db, "gestiones", id), {
      ...datos,
      actualizadoEn: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    console.error("Error actualizando gestión:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

export async function eliminarGestion(id) {
  try {
    await deleteDoc(doc(db, "gestiones", id));
    return { ok: true };
  } catch (error) {
    console.error("Error eliminando gestión:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// CONFIGURACIÓN: cuotas del equipo (config/cuotas)
// Documento único: { anio: 2026, valores: { "Nombre Rep": cuota } }
// Todos pueden leerlo (cada rep necesita su cuota);
// solo Gerencia puede escribirlo (lo imponen las reglas).
// ───────────────────────────────────────────────

export function suscribirCuotas(callback, onError) {
  return onSnapshot(doc(db, "config", "cuotas"), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  }, (error) => {
    console.error("Error escuchando cuotas:", error);
    if (onError) onError(error);
  });
}

export async function guardarCuotas(anio, valores) {
  try {
    await setDoc(doc(db, "config", "cuotas"), {
      anio,
      valores,
      actualizadoEn: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    console.error("Error guardando cuotas:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// SPRINT · BASE INSTALADA (colección: cuentasSprint)
// Un documento por cuenta. Id = slug del nombre de la cuenta.
// Reglas: todos leen; solo Gerencia crea/borra; el vendedor
// asignado (campo "rep") solo edita contacto y seguimiento.
// ───────────────────────────────────────────────

export function suscribirCuentasSprint(callback, onError) {
  return onSnapshot(collection(db, "cuentasSprint"), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (error) => {
    console.error("Error escuchando cuentasSprint:", error);
    if (onError) onError(error);
  });
}

export async function actualizarCuentaSprint(id, datos) {
  try {
    await updateDoc(doc(db, "cuentasSprint", id), { ...datos, actualizadoEn: serverTimestamp() });
    return { ok: true };
  } catch (error) {
    console.error("Error actualizando cuenta del sprint:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// Reasignar o eliminar varias cuentas a la vez (solo Gerencia).
// ids = [id, ...]; para reasignar, rep = nombre del nuevo responsable.
export async function reasignarCuentasSprint(ids, rep) {
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) batch.update(doc(db, "cuentasSprint", id), { rep, actualizadoEn: serverTimestamp() });
      await batch.commit();
    }
    return { ok: true };
  } catch (error) {
    console.error("Error reasignando cuentas del sprint:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

export async function eliminarCuentasSprint(ids) {
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) batch.delete(doc(db, "cuentasSprint", id));
      await batch.commit();
    }
    return { ok: true };
  } catch (error) {
    console.error("Error eliminando cuentas del sprint:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// Carga masiva (solo Gerencia). `items` = [{ id, datos }].
// Usa merge: no borra lo que los comerciales ya hayan llenado.
export async function importarCuentasSprint(items) {
  try {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const { id, datos } of items.slice(i, i + 400)) {
        batch.set(doc(db, "cuentasSprint", id), { ...datos, actualizadoEn: serverTimestamp() }, { merge: true });
      }
      await batch.commit();
    }
    return { ok: true };
  } catch (error) {
    console.error("Error importando cuentas del sprint:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// CUENTAS · ficha del cliente (colección: cuentas) — nov 2026
// Un documento por cliente. Id = slug del nombre (ver idCuenta()).
//   { nombre, canal: "Retail"|"Corporativo", sector: "Público"|"Privado",
//     contactos: [{ nombre, cargo, correo, telefono, creadoPor, fecha }],
//     creadoPor, creadoEn, actualizadoEn }
// Reglas: todos leen y crean; un vendedor solo puede AGREGAR
// contactos y completar canal/sector si estaban vacíos.
// ───────────────────────────────────────────────

// Llave única de la cuenta (ver catalogos.js): "Laboratorios Provet S.A.S."
// y "LABORATORIOS PROVET SA" dan la misma: "laboratorios-provet".
export function idCuenta(nombre) { return claveCuenta(nombre); }

export function suscribirCuentas(callback, onError) {
  return onSnapshot(collection(db, "cuentas"), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (error) => {
    console.error("Error escuchando cuentas:", error);
    if (onError) onError(error);
  });
}

// Crea la ficha de una cuenta nueva.
export async function crearCuenta(id, datos) {
  try {
    await setDoc(doc(db, "cuentas", id), {
      contactos: [],
      ...datos,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    return { ok: true, id };
  } catch (error) {
    console.error("Error creando cuenta:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// Completa canal / sector de una ficha existente.
export async function actualizarCuenta(id, datos) {
  try {
    await updateDoc(doc(db, "cuentas", id), { ...datos, actualizadoEn: serverTimestamp() });
    return { ok: true };
  } catch (error) {
    console.error("Error actualizando cuenta:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// Agrega un contacto a la ficha (sin borrar los que ya había).
export async function agregarContactoCuenta(id, contacto) {
  try {
    await updateDoc(doc(db, "cuentas", id), {
      contactos: arrayUnion(contacto),
      actualizadoEn: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    console.error("Error agregando contacto:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// BROKERS (colección: brokers) — nov 2026
// { nombre, empresa, contacto, correo, telefono, notas, creadoPor }
// Reglas: todos leen; cualquiera crea a su nombre; solo Gerencia edita y borra.
// ───────────────────────────────────────────────
export function suscribirBrokers(callback, onError) {
  return onSnapshot(collection(db, "brokers"), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (error) => {
    console.error("Error escuchando brokers:", error);
    if (onError) onError(error);
  });
}
export async function crearBroker(datos) {
  try {
    const id = claveCuenta(datos.nombre);
    await setDoc(doc(db, "brokers", id), { ...datos, creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });
    return { ok: true, id };
  } catch (error) {
    console.error("Error creando broker:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}
export async function actualizarBroker(id, datos) {
  try {
    await updateDoc(doc(db, "brokers", id), { ...datos, actualizadoEn: serverTimestamp() });
    return { ok: true };
  } catch (error) {
    console.error("Error actualizando broker:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}
export async function eliminarBroker(id) {
  try {
    await deleteDoc(doc(db, "brokers", id));
    return { ok: true };
  } catch (error) {
    console.error("Error eliminando broker:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// CALIDAD DE DATOS (solo Gerencia) — nov 2026
// Aplica muchos cambios en lotes de 400.
//   cambios = [{ col: "deals"|"gestiones"|"cuentasSprint"|"cuentas"|"brokers",
//                id, datos }]            → update (datos = campos a cambiar)
//              { col, id, borrar: true } → delete
//              { col, id, crear: datos } → set con merge
// ───────────────────────────────────────────────
export async function aplicarCambiosLote(cambios) {
  try {
    for (let i = 0; i < cambios.length; i += 400) {
      const batch = writeBatch(db);
      for (const c of cambios.slice(i, i + 400)) {
        const ref = doc(db, c.col, c.id);
        if (c.borrar) batch.delete(ref);
        else if (c.crear) batch.set(ref, { ...c.crear, actualizadoEn: serverTimestamp() }, { merge: true });
        else batch.update(ref, { ...c.datos, actualizadoEn: serverTimestamp() });
      }
      await batch.commit();
    }
    return { ok: true };
  } catch (error) {
    console.error("Error aplicando cambios en lote:", error);
    return { ok: false, error: traducirErrorFirestore(error) };
  }
}

// ───────────────────────────────────────────────
// Mensajes de error claros en español
// ───────────────────────────────────────────────
function traducirErrorFirestore(error) {
  if (error.code === "permission-denied") {
    return "No tienes permiso para esta acción. Verifica que el registro esté a tu nombre.";
  }
  if (error.code === "unavailable") {
    return "Sin conexión con la base de datos. Verifica tu internet.";
  }
  return "Ocurrió un error al guardar. Intenta de nuevo.";
}
