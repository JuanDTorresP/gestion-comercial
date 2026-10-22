// ═══════════════════════════════════════════════════════════
// sprint-config.js — v1 (Fase 1, oct 2026)
// Constantes del "Sprint de Tracción · Base Instalada + FLEX".
// Las comparten agenda-view.js (registro) y sprint-view.js (tablero).
// En la Fase 2 las metas pasarán a Firestore (config/sprint) para
// que Gerencia las edite sin tocar código.
// ═══════════════════════════════════════════════════════════

export const SPRINT = {
  inicio: "2026-10-26",
  fin: "2027-01-22",
  dias: 90,
  festivos: ["2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25", "2027-01-01", "2027-01-11"]
};

// Equipo del sprint (Elizabeth ya no está en el equipo).
export const REPS_SPRINT = ["Patricia Lopera", "Clemencia Rodriguez", "Ivan Muñoz", "Johana Mayo"];

// Acciones del sprint que se registran desde una gestión de la Agenda.
// Se guardan en el campo `sprintAccion` de la gestión (no se toca `tipo`,
// para que las gráficas Comercial/Operativo sigan iguales).
export const ACCIONES_SPRINT = {
  ruta:       { label: "Paso de la ruta de contacto", corto: "Ruta",            frente: "base" },
  chequeo:    { label: "Chequeo de espacio",          corto: "Chequeo",         frente: "base" },
  invitacion: { label: "Invitación FLEX enviada",     corto: "Invitación FLEX", frente: "flex" },
  jornada:    { label: "Jornada FLEX realizada",      corto: "Jornada FLEX",    frente: "flex" },
  referido:   { label: "Referido obtenido",           corto: "Referido",        frente: "base" }
};

// Ruta de 12 días. Se guarda en `sprintPaso`.
export const PASOS_RUTA = ["Día 1 · Llamada", "Día 2 · Correo", "Día 5 · WhatsApp", "Día 8 · LinkedIn", "Día 12 · Cierre"];

// Metas del sprint (iguales a las del tablero original).
// semanal = meta de la semana para todo el equipo · total = meta a 90 días.
export const METAS = {
  cuentasContactadas: { total: 28 },
  conDecisor:         { semanal: 2, total: 20 },
  chequeos:           { semanal: 1, total: 10 },
  invitaciones:       { semanal: 4, total: 45 },
  jornadas:           { semanal: 1, total: 12 },
  referidos:          { total: 3 },
  // Fase 2 (calificación en el pipeline):
  calificadasBase: { total: 6 },  cotizacionesBase: { total: 5 }, cerradosBase: { total: 2 },
  calificadasFlex: { total: 5 },  cotizacionesFlex: { total: 3 }, cerradosFlex: { total: 1 }
};
