// backend/src/routes/resultados.js
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const https = require("https");

const Resultado = require("../models/resultado");
const Interaccion = require("../models/interaccion");

// ✅ Cargar concepciones alternativas (lista cerrada)
const acData = require("../alternative_conceptions.json");
const AC_MAP = acData?.alternative_conceptions || {};
const ALLOWED_AC_IDS = Object.keys(AC_MAP);
const ALLOWED_AC_IDS_TEXT = ALLOWED_AC_IDS.join(", ");

const router = express.Router();

/**
 * ✅ Elegimos SIEMPRE URL UPV si existe, si no la genérica.
 * (Esto es clave: antes podías estar llamando a local/fallback sin querer.)
 */
const OLLAMA_BASE_URL =
  process.env.OLLAMA_UPV_URL ||
  process.env.OLLAMA_API_URL ||
  "https://ollama.gti-ia.upv.es:443";

/**
 * ✅ Timeout realista para UPV (clasificación no-stream).
 * Ajusta si quieres, pero 20s era demasiado agresivo.
 */
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_CLASSIFIER_TIMEOUT_MS || 120000);

/**
 * Si en algún momento activas insecureTLS, te lo permite sin romper.
 */
const insecureTLS = String(process.env.OLLAMA_INSECURE_TLS || "").toLowerCase() === "on";
const httpsAgent = insecureTLS
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

const ollama = axios.create({
  baseURL: OLLAMA_BASE_URL,
  timeout: OLLAMA_TIMEOUT_MS,
  httpsAgent
});

/**
 * Parser robusto: a veces el modelo devuelve texto alrededor.
 * Extrae el primer bloque JSON { ... } si existe.
 */
function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s) return null;

  // Caso ideal: ya es JSON puro
  if (s.startsWith("{") && s.endsWith("}")) {
    try { return JSON.parse(s); } catch { /* continue */ }
  }

  // Caso: JSON embebido en texto
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
// GET /api/resultados/completed/:userId
router.get("/completed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido." });
    }

    const resultados = await Resultado.find({ usuario_id: userId })
      .select("ejercicio_id")
      .lean();

    // IDs únicos de ejercicios completados
    const completedIds = [
      ...new Set(resultados.map(r => String(r.ejercicio_id)))
    ];

    return res.status(200).json(completedIds);
  } catch (error) {
    console.error("Error obteniendo ejercicios completados:", error);
    return res.status(500).json({ message: "Error del servidor." });
  }
});

// ✅ GET /api/resultados/completed?userId=xxxx
// ✅ GET /api/resultados/completed/xxxx
router.get("/completed", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido." });
    }

    const resultados = await Resultado.find({ usuario_id: userId })
      .select("ejercicio_id")
      .lean();

    const completedIds = [...new Set(resultados.map((r) => String(r.ejercicio_id)))];
    return res.status(200).json(completedIds);
  } catch (error) {
    console.error("Error obteniendo ejercicios completados:", error);
    return res.status(500).json({ message: "Error del servidor." });
  }
});

router.get("/completed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido." });
    }

    const resultados = await Resultado.find({ usuario_id: userId })
      .select("ejercicio_id")
      .lean();

    const completedIds = [...new Set(resultados.map((r) => String(r.ejercicio_id)))];
    return res.status(200).json(completedIds);
  } catch (error) {
    console.error("Error obteniendo ejercicios completados:", error);
    return res.status(500).json({ message: "Error del servidor." });
  }
});


// POST /api/resultados/finalizar
router.post("/finalizar", async (req, res) => {
  try {
    const { userId, exerciseId, interaccionId, resueltoALaPrimera = false } = req.body;

    if (!userId || !exerciseId || !interaccionId) {
      return res.status(400).json({ message: "Faltan datos para finalizar el resultado." });
    }

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

    const conversacion = Array.isArray(interaccion.conversacion) ? interaccion.conversacion : [];
    const numMensajes = conversacion.length;

    const conversacionTexto =
      conversacion.length > 0
        ? conversacion.map((m) => `${m.role}: ${m.content}`).join("\n")
        : "Conversación vacía.";

    // ====== PROMPT CLASIFICADOR ======
    const promptParaOllama = `
Eres un asistente que clasifica concepciones alternativas (AC) en un diálogo de tutoría.

REGLAS ESTRICTAS (OBLIGATORIAS):
- Devuelve ÚNICAMENTE JSON válido.
- No escribas ningún texto fuera del JSON.
- No incluyas explicaciones, comentarios ni markdown.
- Si incumples el formato, la respuesta se considerará inválida.

Solo puedes devolver IDs de esta lista cerrada:
${ALLOWED_AC_IDS_TEXT}

Devuelve como máximo 3 IDs.
Si no detectas ninguna con claridad, devuelve [].

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
`.trim();

    // ====== IA opcional (si falla, guardamos igualmente métricas objetivas) ======
    let analisisIA = null;
    let consejoIA = null;
    let errores = [];

    // Modelo para clasificar: puedes separar del modelo tutor si quieres
    const model = process.env.OLLAMA_CLASSIFIER_MODEL || process.env.OLLAMA_MODEL;

    try {
      // 1) Llamada a Ollama (no stream)
      const ollamaResponse = await ollama.post("/api/chat", {
        model,
        messages: [{ role: "user", content: promptParaOllama }],
        format: "json",
        stream: false
      });

      const content = ollamaResponse?.data?.message?.content;
      const parsed = extractJsonObject(content);

      if (!parsed) {
        throw new Error("Clasificador devolvió contenido no-JSON o JSON inválido.");
      }

      if (typeof parsed.analisis === "string" && parsed.analisis.trim()) {
        analisisIA = parsed.analisis.trim();
      }
      if (typeof parsed.consejo === "string" && parsed.consejo.trim()) {
        consejoIA = parsed.consejo.trim();
      }

      const acs = Array.isArray(parsed.acs) ? parsed.acs : [];
      const acsFiltrados = acs
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => ALLOWED_AC_IDS.includes(id))
        .slice(0, 3);

      errores = acsFiltrados.map((id) => ({
        etiqueta: id,
        texto: AC_MAP[id]?.name || id
      }));
    } catch (e) {
      // ✅ MUY IMPORTANTE: si falla, deja rastro mínimo para que NO salga vacío siempre
      // (así verás “algo” en dashboard y sabrás que el clasificador falló)
      console.error("[RESULTADOS] Clasificador AC falló:", e?.message || e);

      // Si quieres que quede vacío cuando falla, comenta este bloque.
      // Yo lo dejo para depurar y para que el dashboard muestre señal.
      if (numMensajes > 0) {
        errores = [{
          etiqueta: "AC_UNK",
          texto: "No se pudo clasificar (timeout o formato inválido)"
        }];
      }
    }

    const nuevoResultado = new Resultado({
      usuario_id: userId,
      ejercicio_id: exerciseId,
      interaccion_id: interaccionId,
      resueltoALaPrimera,
      numMensajes,
      analisisIA,
      consejoIA,
      errores
    });

    await nuevoResultado.save();

    return res.status(200).json({
      message: "Resultado guardado con éxito.",
      saved: {
        numMensajes,
        analisisIA: Boolean(analisisIA),
        consejoIA: Boolean(consejoIA),
        errores: (errores || []).map((x) => x.etiqueta)
      }
    });
  } catch (error) {
    console.error("Error al finalizar resultado:", error);
    return res.status(500).json({ message: "Error del servidor al finalizar resultado." });
  }
});

module.exports = router;
