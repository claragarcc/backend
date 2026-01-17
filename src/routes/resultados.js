const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const Resultado = require("../models/resultado");
const Interaccion = require("../models/interaccion");

// ✅ Cargar concepciones alternativas (lista cerrada)
const acData = require("../alternative_conceptions.json");
const AC_MAP = acData?.alternative_conceptions || {};
const ALLOWED_AC_IDS = Object.keys(AC_MAP); // ["AC1","AC2",...]
const ALLOWED_AC_IDS_TEXT = ALLOWED_AC_IDS.join(", ");

const router = express.Router();

// POST /api/resultados/finalizar
router.post("/finalizar", async (req, res) => {
  try {
    const { userId, exerciseId, interaccionId, resueltoALaPrimera = false } = req.body;

    if (!userId || !exerciseId || !interaccionId) {
      return res.status(400).json({ message: "Faltan datos para finalizar el resultado." });
    }

    // Validación de IDs
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(exerciseId) ||
      !mongoose.Types.ObjectId.isValid(interaccionId)
    ) {
      return res.status(400).json({ message: "Alguno de los IDs no es válido." });
    }

    const interaccion = await Interaccion.findById(interaccionId);
    if (!interaccion) {
      return res.status(404).json({ message: "Interacción no encontrada." });
    }

    // ✅ MÉTRICA OBJETIVA (siempre)
    const numMensajes = Array.isArray(interaccion.conversacion)
      ? interaccion.conversacion.length
      : 0;

    const conversacionTexto = Array.isArray(interaccion.conversacion)
      ? interaccion.conversacion.map((m) => `${m.role}: ${m.content}`).join("\n")
      : "Conversación no disponible.";

    /**
     * ✅ Nuevo enfoque:
     * - El LLM NO inventa etiquetas.
     * - Solo devuelve IDs existentes: AC1, AC13, AC14...
     * - El texto lo sacamos nosotros del JSON (estable).
     */
    const promptParaOllama = `
Eres un asistente que clasifica concepciones alternativas (AC) en un diálogo.

REGLAS ESTRICTAS (OBLIGATORIAS):
- Devuelve ÚNICAMENTE JSON válido.
- No escribas ningún texto fuera del JSON.
- No incluyas explicaciones, comentarios ni markdown.
- Si incumples el formato, la respuesta se considerará inválida.

- Solo puedes devolver IDs de esta lista cerrada:
  ${ALLOWED_AC_IDS_TEXT}
- Devuelve como máximo 3 IDs.
- Si no detectas ninguna con claridad, devuelve [].

FORMATO EXACTO DE RESPUESTA:
{
  "analisis": "1-2 frases muy cortas",
  "consejo": "1 frase muy corta",
  "acs": ["AC13", "AC14"]
}

CONVERSACIÓN:
---
${conversacionTexto}
---
`;

    // ✅ Por defecto: IA opcional (si falla, no pasa nada)
    let analisisIA = null;
    let consejoIA = null;
    let errores = []; // aquí guardaremos [{ etiqueta:"AC13", texto:"..." }]

    try {
      const ollamaResponse = await axios.post(
        `${process.env.OLLAMA_API_URL}/api/chat`,
        {
          model: process.env.OLLAMA_MODEL,
          messages: [{ role: "user", content: promptParaOllama }],
          format: "json",
          stream: false
        },
        { timeout: 20000 }
      );

      const content = ollamaResponse?.data?.message?.content;

      if (typeof content === "string" && content.trim().length > 0) {
        const parsed = JSON.parse(content);

        // 1) Analisis / consejo (opcionales)
        if (typeof parsed?.analisis === "string" && parsed.analisis.trim().length > 0) {
          analisisIA = parsed.analisis.trim();
        }
        if (typeof parsed?.consejo === "string" && parsed.consejo.trim().length > 0) {
          consejoIA = parsed.consejo.trim();
        }

        // 2) ACs: lista cerrada + mapeo a texto desde JSON
        const acs = Array.isArray(parsed?.acs) ? parsed.acs : [];
        const acsFiltrados = acs
          .filter((id) => typeof id === "string")
          .map((id) => id.trim())
          .filter((id) => ALLOWED_AC_IDS.includes(id))
          .slice(0, 3);

        errores = acsFiltrados.map((id) => ({
          etiqueta: id,
          // ✅ texto estable desde tu JSON
          texto: AC_MAP[id]?.name || id
        }));
      }
    } catch (e) {
      console.error("Ollama falló o devolvió JSON inválido:", e?.message || e);
      // analisisIA=null, consejoIA=null, errores=[]
    }

    const nuevoResultado = new Resultado({
      usuario_id: userId,
      ejercicio_id: exerciseId,
      interaccion_id: interaccionId,
      resueltoALaPrimera,

      // ✅ objetivo, siempre
      numMensajes,

      // ✅ opcional IA
      analisisIA,
      consejoIA,

      // ✅ errores ya NO inventados: son AC*
      errores
    });

    await nuevoResultado.save();

    return res.status(200).json({
      message: "Resultado guardado con éxito.",
      saved: {
        numMensajes,
        analisisIA: Boolean(analisisIA),
        consejoIA: Boolean(consejoIA),
        errores: errores.map((e) => e.etiqueta)
      }
    });
  } catch (error) {
    console.error("Error al finalizar resultado:", error);
    return res.status(500).json({ message: "Error del servidor al finalizar resultado." });
  }
});

// GET /api/resultados/completed/:userId
router.get("/completed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userResults = await Resultado.find({ usuario_id: userId });

    const completedExerciseIds = [...new Set(userResults.map((r) => r.ejercicio_id.toString()))];

    return res.status(200).json(completedExerciseIds);
  } catch (error) {
    console.error("Error al obtener ejercicios completados:", error);
    return res.status(500).json({ message: "Error del servidor." });
  }
});

module.exports = router;
