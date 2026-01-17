// backend/src/utils/promptBuilder.js
const fs = require("fs");
const path = require("path");

// 1) Prompt base (reglas generales del tutor)
const PROMPT_BASE_PATH = path.join(__dirname, "..", "prompts", "prompt_base.md");
const PROMPT_BASE = fs.readFileSync(PROMPT_BASE_PATH, "utf-8").trim();

// 2) Catálogo AC (para referenciar por ID)
const AC_CATALOG_PATH = path.join(__dirname, "..", "data", "alternative_conceptions.json");
const AC_DATA = JSON.parse(fs.readFileSync(AC_CATALOG_PATH, "utf-8"));
const AC_CATALOG = AC_DATA?.alternative_conceptions || {};

/**
 * Ajustes técnicos por modelo (NO docencia).
 * Solo afecta al estilo para mejorar estabilidad.
 */
function modelStyleAppendix() {
  const model = (process.env.OLLAMA_MODEL || "").toLowerCase();

  if (model.includes("qwen2.5")) {
    return [
      "AJUSTES TÉCNICOS (ESTILO) PARA EL MODELO:",
      "- Sé conciso: respuestas cortas y enfocadas.",
      "- Haz preguntas concretas y directas (1-3 por turno).",
      "- Evita divagar o añadir contenido innecesario.",
      "- Mantén estructura estable: (1) detectar error si aplica (2) preguntar (3) siguiente paso.",
    ].join("\n");
  }

  return "";
}

/**
 * Construye el system prompt final para el tutor.
 * IMPORTANTE (rendimiento): NO expandir el catálogo completo de AC.
 * Solo incluimos IDs + nombre para no inflar tokens.
 */
function buildTutorSystemPrompt(ejercicio) {
  // Si no hay ejercicio, devolvemos el prompt base
  if (!ejercicio) return PROMPT_BASE;

  const partes = [PROMPT_BASE];

  const appendix = modelStyleAppendix();
  if (appendix) partes.push(appendix);

  // Título y enunciado (útiles para el tutor)
  if (ejercicio.titulo) partes.push(`TÍTULO DEL EJERCICIO:\n${ejercicio.titulo}`);
  if (ejercicio.enunciado) partes.push(`ENUNCIADO:\n${ejercicio.enunciado}`);

  // Nuevo formato recomendado (tutorContext)
  const ctx = ejercicio.tutorContext;

  if (ctx) {
    if (ctx.objetivo) partes.push(`OBJETIVO DEL EJERCICIO:\n${ctx.objetivo}`);
    if (ctx.netlist) partes.push(`NETLIST / DATOS DEL CIRCUITO:\n${ctx.netlist}`);
    if (ctx.modoExperto) partes.push(`MODO DE PENSAR DEL EXPERTO:\n${ctx.modoExperto}`);

    // ACs: versión LIGERA (solo ID + nombre)
    if (Array.isArray(ctx.ac_refs) && ctx.ac_refs.length > 0) {
      const acsLigero = ctx.ac_refs
        .map((id) => AC_CATALOG[id])
        .filter(Boolean)
        .map((ac) => `${ac.id}: ${ac.name}`);

      if (acsLigero.length > 0) {
        partes.push(
          `CONCEPCIONES ALTERNATIVAS A CONSIDERAR (IDs):\n- ${acsLigero.join("\n- ")}`
        );
      }
    }
  } else if (ejercicio.contextoTutor) {
    // Legacy (por si aún existe en Mongo en algún ejercicio)
    partes.push(`CONTEXTO DEL EJERCICIO (LEGACY):\n${ejercicio.contextoTutor}`);
  }

  // Reglas finales de salida (compactas)
  partes.push(
    [
      "INSTRUCCIONES DE RESPUESTA:",
      "- Guía al estudiante mediante preguntas.",
      "- No proporciones la solución directamente.",
      "- Si detectas una concepción alternativa, indícalo de forma breve y reconduce con preguntas.",
      "- Mantén enfoque socrático.",
    ].join("\n")
  );

  return partes.join("\n\n");
}

module.exports = { buildTutorSystemPrompt };
