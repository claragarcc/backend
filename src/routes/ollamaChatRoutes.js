// backend/src/routes/ollamaChatRoutes.js
const express = require("express");
const axios = require("axios");
const Interaccion = require("../models/interaccion");
const Ejercicio = require("../models/ejercicio");
const mongoose = require("mongoose");
const { buildTutorSystemPrompt } = require("../utils/promptBuilder");

require("dotenv").config();

const router = express.Router();

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:latest";


// Ajustes por defecto (puedes retocar luego)
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);
const OLLAMA_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT || 180);
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 1024);
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.4);

console.log("[OLLAMA CFG] URL =", OLLAMA_API_URL);
console.log("[OLLAMA CFG] MODEL =", OLLAMA_MODEL);
console.log("[OLLAMA CFG] timeout(ms) =", OLLAMA_TIMEOUT_MS, "ctx =", OLLAMA_NUM_CTX, "predict =", OLLAMA_NUM_PREDICT);

/**
 * Helper: llama a Ollama con options + timeout
 */
async function callOllamaChat(messages) {
  return axios.post(
    `${OLLAMA_API_URL}/api/chat`,
    {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      keep_alive: "10m",
      options: {
        num_predict: OLLAMA_NUM_PREDICT,
        num_ctx: OLLAMA_NUM_CTX,
        temperature: OLLAMA_TEMPERATURE,
      },
    },
    { timeout: OLLAMA_TIMEOUT_MS }
  );
}

// =====================================================
// POST /api/ollama/chat/start-exercise
// Iniciar nueva conversación
// =====================================================
router.post("/chat/start-exercise", async (req, res) => {
  try {
    const { userId, exerciseId, userMessage } = req.body;

    // Validación
    if (!userId || !exerciseId || !userMessage) {
      return res.status(400).json({
        message: "Faltan datos: userId, exerciseId o userMessage.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(exerciseId)) {
      return res.status(400).json({ message: "IDs de usuario o ejercicio inválidos." });
    }

    // Buscar ejercicio
    const ejercicio = await Ejercicio.findById(exerciseId);
    if (!ejercicio) {
      return res.status(404).json({ message: "Ejercicio no encontrado." });
    }

    console.time("LLM_total");
    console.time("LLM_buildPrompt");

    let systemPrompt = buildTutorSystemPrompt(ejercicio);

    console.timeEnd("LLM_buildPrompt");
    console.log("systemPrompt chars =", systemPrompt?.length || 0);

    // Fallback mínimo (robustez)
    if (typeof systemPrompt !== "string" || systemPrompt.trim() === "") {
      console.warn(`System prompt vacío para el ejercicio ${exerciseId}. Usando fallback mínimo.`);
      systemPrompt = "Eres un tutor socrático. Responde en español. No des la solución: guía con preguntas.";
    }

    const initialMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    console.time("LLM_ollamaCall");
    const ollamaResponse = await callOllamaChat(initialMessages);
    console.timeEnd("LLM_ollamaCall");
    console.timeEnd("LLM_total");

    const assistantResponseContent = ollamaResponse?.data?.message?.content ?? "";

    const nuevaInteraccion = new Interaccion({
      usuario_id: userId,
      ejercicio_id: exerciseId,
      inicio: new Date(),
      fin: new Date(),
      conversacion: [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantResponseContent },
      ],
    });

    const savedInteraccion = await nuevaInteraccion.save();

    return res.status(201).json({
      message: "Interacción iniciada y primer mensaje procesado por Ollama",
      interaccionId: savedInteraccion._id,
      initialMessage: assistantResponseContent,
      fullHistory: savedInteraccion.conversacion,
    });
  } catch (error) {
    console.error("Error al iniciar nueva interacción/chat con Ollama:", error?.message || error);

    // Axios timeout / conexión
    if (error?.code === "ECONNABORTED") {
      return res.status(504).json({
        message: "Timeout esperando respuesta de Ollama.",
        error: error.message,
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        message: "Error al comunicarse con Ollama.",
        error: error.response.data,
      });
    }

    if (error.request) {
      return res.status(503).json({
        message: "No se pudo conectar con el servidor Ollama.",
        error: error.message,
      });
    }

    return res.status(500).json({
      message: "Error interno del servidor al iniciar interacción.",
      error: error.message,
    });
  }
});

// =====================================================
// POST /api/ollama/chat/message
// Continuar conversación
// =====================================================
router.post("/chat/message", async (req, res) => {
  try {
    const { interaccionId, userMessage } = req.body;

    if (!interaccionId || !userMessage) {
      return res.status(400).json({ message: "Faltan datos: interaccionId o userMessage." });
    }
    if (!mongoose.Types.ObjectId.isValid(interaccionId)) {
      return res.status(400).json({ message: "ID de interacción inválido." });
    }

    const interaccion = await Interaccion.findById(interaccionId);
    if (!interaccion) {
      return res.status(404).json({ message: "Interacción no encontrada." });
    }

    const ejercicio = await Ejercicio.findById(interaccion.ejercicio_id);

    console.time("LLM_total");
    console.time("LLM_buildPrompt");

    let systemPrompt = buildTutorSystemPrompt(ejercicio);

    console.timeEnd("LLM_buildPrompt");
    console.log("systemPrompt chars =", systemPrompt?.length || 0);

    if (typeof systemPrompt !== "string" || systemPrompt.trim() === "") {
      console.warn(`System prompt vacío para la interacción ${interaccionId}. Usando fallback mínimo.`);
      systemPrompt = "Eres un tutor socrático. Responde en español. No des la solución: guía con preguntas.";
    }

    // Guardamos mensaje usuario en DB primero
    interaccion.conversacion.push({ role: "user", content: userMessage });

    // Mensajes a Ollama: system + historial
    const messagesForOllama = [
      { role: "system", content: systemPrompt },
      ...interaccion.conversacion.map((m) => ({ role: m.role, content: m.content })),
    ];

    console.time("LLM_ollamaCall");
    const ollamaResponse = await callOllamaChat(messagesForOllama);
    console.timeEnd("LLM_ollamaCall");
    console.timeEnd("LLM_total");

    const assistantResponseContent = ollamaResponse?.data?.message?.content ?? "";

    interaccion.conversacion.push({ role: "assistant", content: assistantResponseContent });
    interaccion.fin = new Date();

    const updatedInteraccion = await interaccion.save();

    return res.status(200).json({
      message: "Mensaje procesado y conversación actualizada por Ollama.",
      assistantMessage: assistantResponseContent,
      fullHistory: updatedInteraccion.conversacion,
    });
  } catch (error) {
    console.error("Error al procesar mensaje de chat con Ollama:", error?.message || error);

    if (error?.code === "ECONNABORTED") {
      return res.status(504).json({
        message: "Timeout esperando respuesta de Ollama.",
        error: error.message,
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        message: "Error al comunicarse con Ollama.",
        error: error.response.data,
      });
    }

    if (error.request) {
      return res.status(503).json({
        message: "No se pudo conectar con el servidor Ollama.",
        error: error.message,
      });
    }

    return res.status(500).json({
      message: "Error interno del servidor al procesar mensaje.",
      error: error.message,
    });
  }
});

module.exports = router;
