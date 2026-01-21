function safeStr(x) {
  if (typeof x !== "string") return "";
  return x.trim();
}

function joinBlocks(blocks) {
  return blocks.map(safeStr).filter(Boolean).join("\n\n");
}

function buildTutorContextBlock(ejercicio) {
  const tc = ejercicio?.tutorContext || {};

  // Si por lo que sea tienes el contexto largo en otro sitio (CA), lo metemos como fallback.
  const caFallback = safeStr(ejercicio?.CA);

  const objetivo = safeStr(tc.objetivo);
  const contextoCompleto = safeStr(tc.contextoCompleto);
  const netlist = safeStr(tc.netlist);
  const modoExperto = safeStr(tc.modoExperto);

  const acRefs = Array.isArray(tc.ac_refs) ? tc.ac_refs.filter((x) => typeof x === "string" && x.trim()) : [];
  const version = tc?.version != null ? String(tc.version) : "";

  // Si no hay nada en tutorContext, devolvemos CA si existe.
  const hasAny =
    objetivo || contextoCompleto || netlist || modoExperto || acRefs.length > 0 || version;

  if (!hasAny) return caFallback;

  const parts = [];

  // Contexto general / objetivo
  if (objetivo) parts.push(`OBJETIVO:\n${objetivo}`);

  // Contexto completo (puede incluir “Instrucciones…” y ACs ya redactadas)
  if (contextoCompleto) parts.push(`CONTEXTO DEL EJERCICIO:\n${contextoCompleto}`);

  // Netlist separado (si lo guardas aparte)
  if (netlist) parts.push(`NETLIST:\n${netlist}`);

  // Modo experto separado
  if (modoExperto) parts.push(`MODO DE PENSAR EXPERTO:\n${modoExperto}`);

  // Referencias a ACs (solo ids)
  if (acRefs.length > 0) parts.push(`ACs RELEVANTES (IDs): ${acRefs.join(", ")}`);

  if (version) parts.push(`VERSIÓN CONTEXTO: ${version}`);

  return parts.join("\n\n");
}

function buildTutorRulesBlock() {
  return `
Eres un tutor socrático para ayudar al estudiante a razonar.
- Responde SIEMPRE en español.
- NO des la solución final directamente.
- Haz preguntas cortas y concretas (1–2 por turno).
- Si el estudiante se equivoca, guía para que detecte el error.
- Mantén un tono claro, paciente y técnico.
`.trim();
}

function buildExerciseInfoBlock(ejercicio) {
  const titulo = safeStr(ejercicio?.titulo);
  const enunciado = safeStr(ejercicio?.enunciado);
  const concepto = safeStr(ejercicio?.concepto);
  const asignatura = safeStr(ejercicio?.asignatura);
  const nivel = ejercicio?.nivel != null ? String(ejercicio.nivel) : "";
  const imagen = safeStr(ejercicio?.imagen);

  return `
EJERCICIO ACTUAL:
${titulo ? `Título: ${titulo}` : ""}
${asignatura ? `Asignatura: ${asignatura}` : ""}
${concepto ? `Concepto: ${concepto}` : ""}
${nivel ? `Nivel: ${nivel}` : ""}
${enunciado ? `Enunciado: ${enunciado}` : ""}
${imagen ? `Imagen asociada (referencia): ${imagen}` : ""}
`.trim();
}

/**
 * Prompt del sistema:
 * - Usa el objeto tutorContext del schema real
 * - Reglas globales una sola vez
 * - Metadatos del ejercicio
 */
function buildTutorSystemPrompt(ejercicio) {
  const tutorContextBlock = buildTutorContextBlock(ejercicio);
  const rules = buildTutorRulesBlock();
  const ejercicioInfo = buildExerciseInfoBlock(ejercicio);

  return joinBlocks([tutorContextBlock, rules, ejercicioInfo]);
}

module.exports = { buildTutorSystemPrompt };
