// ═══════════════════════════════════════════════════════════
// catalogos.js — v1.0 (nov 2026)
// ÚNICA fuente de las LISTAS CERRADAS del CRM y de las reglas para
// reconocer una misma cuenta escrita de formas distintas.
// No habla con Firebase: solo funciones puras. La usan Pipeline,
// Agenda, Sprint y la Ficha de cuenta, así todos hablan igual.
// ═══════════════════════════════════════════════════════════

// ── Listas cerradas ──
export const TIPOS = ["Venta", "Renta"];
export const CANALES = ["Directo", "Indirecto"];
// Origen según el canal: Directo → uno de estos; Indirecto → Broker
export const ORIGENES_DIRECTO = ["Referido", "Rep", "Gerencia", "CRM"];
export const ORIGEN_INDIRECTO = "Broker";
export const ORIGENES = [...ORIGENES_DIRECTO, ORIGEN_INDIRECTO];
export const SEGMENTOS = ["Retail", "Corporativo", "Público"];
export const SEGMENTO_TXT = { "Retail": "🏪 Retail", "Corporativo": "🏢 Corporativo", "Público": "🏛 Público" };

// ═══════════════════════════════════════════
// CUENTAS: llave única
// "Laboratorios Provet S.A.S." = "LABORATORIOS PROVET SA" = "laboratorios provet"
// Ignora mayúsculas, tildes, puntos/comas y la razón social al final
// (SAS, SA, LTDA, EU, BIC, S en C, SCA, Inc, LLC, Ltd).
// ═══════════════════════════════════════════
const SUFIJOS = new Set(["sas", "sa", "ltda", "limitada", "eu", "bic", "sca", "scs", "senc", "sencs", "senca", "inc", "llc", "ltd"]);

export function tokensCuenta(nombre) {
  const s = String(nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " y ").replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return [];
  // Une letras sueltas seguidas: "s a s" → "sas", "s en c" → "senc"
  const t = [];   // [{ w, suelta }]
  for (const w of s.split(/\s+/)) {
    const prev = t[t.length - 1];
    if (prev && prev.suelta && (w.length === 1 || w === "en")) prev.w += w;
    else t.push({ w, suelta: w.length === 1 });
  }
  const out = t.map(x => x.w);
  // Quita la razón social al final (puede haber varias: "SAS BIC")
  while (out.length > 1 && SUFIJOS.has(out[out.length - 1])) out.pop();
  return out;
}

export function claveCuenta(nombre) {
  const t = tokensCuenta(nombre);
  return t.join("-").slice(0, 120) || "sin-nombre";
}

// Mismo cliente con distinta escritura
export function mismaCuenta(a, b) { return claveCuenta(a) === claveCuenta(b); }

// Palabras genéricas que no ayudan a reconocer un cliente
const GENERICAS = new Set(["de", "del", "la", "las", "el", "los", "y", "grupo", "compania", "cia", "colombia", "colombiana", "sociedad", "empresa", "corporacion", "inversiones", "comercializadora", "laboratorios", "laboratorio", "industrias", "the"]);

// Parecido entre dos cuentas (0 a 1) para sugerir POSIBLES duplicados
// que la llave no une sola (ej. "Provet" y "Laboratorios Provet").
export function parecidoCuentas(a, b) {
  const A = new Set(tokensCuenta(a).filter(w => !GENERICAS.has(w)));
  const B = new Set(tokensCuenta(b).filter(w => !GENERICAS.has(w)));
  if (!A.size || !B.size) return 0;
  let comun = 0;
  A.forEach(w => { if (B.has(w)) comun++; });
  const jacc = comun / (A.size + B.size - comun);
  // Si todas las palabras útiles de una están en la otra, es muy probable
  const contenida = comun === Math.min(A.size, B.size) && [...(A.size <= B.size ? A : B)].join("").length >= 4 ? 0.85 : 0;
  return Math.max(jacc, contenida);
}

// Elige el nombre "oficial" entre varias escrituras: la más usada;
// en empate, la que no está toda en MAYÚSCULAS y luego la más completa.
export function nombrePreferido(conteos) {
  const lista = Object.entries(conteos);
  if (!lista.length) return "";
  const mixta = (s) => s !== s.toUpperCase() && s !== s.toLowerCase();
  lista.sort((a, b) => b[1] - a[1] || (mixta(b[0]) - mixta(a[0])) || b[0].length - a[0].length);
  return lista[0][0];
}

// ═══════════════════════════════════════════
// NORMALIZADORES de datos viejos (texto libre) → lista cerrada
// Devuelven "" cuando no se puede saber con certeza.
// ═══════════════════════════════════════════
function plano(v) { return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(); }

export function normTipo(v) {
  const t = plano(v);
  if (t === "venta") return "Venta";
  if (["renta", "alquiler", "arriendo", "arrendamiento"].includes(t)) return "Renta";
  return "";
}
export function normCanal(v) {
  const t = plano(v);
  if (!t) return "";
  if (t.startsWith("direct")) return "Directo";
  if (t.startsWith("indirect") || t.includes("broker") || t.includes("aliado") || t.includes("intermedi")) return "Indirecto";
  return "";
}
export function normOrigen(v) {
  const t = plano(v);
  if (!t) return "";
  if (t.includes("broker") || t.includes("aliado") || t.includes("intermedi")) return "Broker";
  if (t.startsWith("referid") || t.includes("referencia") || t.includes("recomend")) return "Referido";
  if (t.startsWith("gerencia") || t.startsWith("gerente") || t.includes("direccion")) return "Gerencia";
  if (t === "crm" || t.includes("crm") || t.includes("base instalada") || t.includes("sprint") || t.includes("agenda")) return "CRM";
  if (t === "rep" || t.includes("vendedor") || t.includes("comercial") || t.includes("prospecc") || t.includes("propio")) return "Rep";
  return "";
}
export function normSegmento(v) {
  const t = plano(v);
  if (!t) return "";
  if (t.startsWith("retail")) return "Retail";
  if (t.startsWith("corporat")) return "Corporativo";
  if (t.startsWith("public") || t.startsWith("gobierno") || t.includes("estatal") || t.includes("oficial")) return "Público";
  return "";
}
// Segmento de una ficha/gestión vieja: Sector Público manda; si no, su canal Retail/Corporativo.
export function segmentoDeRegistro(r) {
  if (!r) return "";
  return normSegmento(r.segmento)
    || (normSegmento(r.sector) === "Público" ? "Público" : "")
    || normSegmento(r.canal);
}
// Canal del pipeline (Directo / Indirecto). Si trae broker, es Indirecto.
export function canalDeDeal(d) {
  return normCanal(d.canal) || (String(d.broker || "").trim() || normOrigen(d.origen) === "Broker" ? "Indirecto" : "");
}
export function origenDeDeal(d) {
  if (canalDeDeal(d) === "Indirecto") return "Broker";
  return normOrigen(d.origen);
}
