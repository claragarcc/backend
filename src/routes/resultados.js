const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const Resultado = require("../models/resultado");
const Interaccion = require("../models/interaccion");

const router = express.Router();

// La URL completa será: POST /api/resultados/finalizar
router.post("/finalizar", async (req, res) => {
  try {
    const { userId, exerciseId, interaccionId, resueltoALaPrimera = false } = req.body;

    if (!userId || !exerciseId || !interaccionId) {
      return res.status(400).json({ message: "Faltan datos para finalizar el resultado." });
    }

    // (Opcional) Validación de ObjectId para evitar queries raras
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

    const promptParaOllama = `
Un estudiante ha finalizado un ejercicio.
Esta fue su conversación con el tutor:
---
${conversacionTexto}
---

Devuelve ÚNICAMENTE un objeto JSON con estas claves:
- "analisis": resumen muy corto de lo que hizo el estudiante (1-2 frases).
- "consejo": consejo muy breve y directo (1 frase).
- "errores": array con 0 a 3 errores frecuentes detectados en la conversación.

Cada error debe tener:
  - "etiqueta": un código corto tipo "CA_OHM_01"
  - "texto": descripción breve (máx 12 palabras)

Si no detectas errores claros, devuelve "errores": [].
`;

    // Por defecto: insights IA no disponibles (LLM opcional)
    let analisisIA = null;
    let consejoIA = null;
    let errores = [];

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

        // ✅ Validación mínima para no guardar basura
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.analisis === "string" && parsed.analisis.trim().length > 0) {
            analisisIA = parsed.analisis.trim();
          }
          if (typeof parsed.consejo === "string" && parsed.consejo.trim().length > 0) {
            consejoIA = parsed.consejo.trim();
          }
          if (Array.isArray(parsed.errores)) {
            errores = parsed.errores
              .filter((e) => e && typeof e.etiqueta === "string" && e.etiqueta.trim().length > 0)
              .slice(0, 3)
              .map((e) => ({
                etiqueta: String(e.etiqueta).trim(),
                texto:
                  typeof e.texto === "string" && e.texto.trim().length > 0
                    ? e.texto.trim()
                    : String(e.etiqueta).trim()
              }));
          }
        }
      }
    } catch (error) {
      // ✅ Si falla el LLM: NO pasa nada. Guardamos métricas y ya.
      console.error("Ollama falló o devolvió JSON inválido:", error?.message || error);
    }

    const nuevoResultado = new Resultado({
      usuario_id: userId,
      ejercicio_id: exerciseId,
      interaccion_id: interaccionId,
      resueltoALaPrimera,

      // ✅ Objetivo
      numMensajes,

      // ✅ Opcional (IA)
      analisisIA,
      consejoIA,
      errores
    });

    await nuevoResultado.save();

    return res.status(200).json({
      message: "Resultado guardado con éxito.",
      // útil para depurar:
      saved: {
        numMensajes,
        hasAnalisisIA: Boolean(analisisIA),
        hasConsejoIA: Boolean(consejoIA),
        erroresCount: Array.isArray(errores) ? errores.length : 0
      }
    });
  } catch (error) {
    console.error("Error al finalizar resultado:", error);
    return res.status(500).json({ message: "Error del servidor al finalizar resultado." });
  }
});

// --- NUEVA RUTA AÑADIDA ---
// Devuelve una lista de los IDs de los ejercicios que un usuario ha completado.
router.get("/completed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userResults = await Resultado.find({ usuario_id: userId });

    const completedExerciseIds = [
      ...new Set(userResults.map((r) => r.ejercicio_id.toString()))
    ];

    return res.status(200).json(completedExerciseIds);
  } catch (error) {
    console.error("Error al obtener ejercicios completados:", error);
    return res.status(500).json({ message: "Error del servidor." });
  }
});

module.exports = router;
