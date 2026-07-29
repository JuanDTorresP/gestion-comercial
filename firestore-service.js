// ═══════════════════════════════════════════════════════════
// firestore-service.js
// ÚNICA capa que habla con la base de datos Cloud Firestore.
// Las vistas (pipeline, agenda) nunca importan Firestore
// directamente: usan estas funciones.
//
// Colecciones:
//   deals     → oportunidades del Pipeline 2026
//   gestiones → registros de la Agenda Comercial
//
// Todas las funciones de escritura devuelven { ok, error }.
// Las suscripciones entregan los datos EN VIVO: cada vez que
// alguien del equipo crea o edita algo, el callback se vuelve
// a ejecutar con la lista actualizada.
// ═══════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
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
