const express = require("express");
const axios = require("axios");
const Interaccion = require("../models/interaccion");
const Ejercicio = require("../models/ejercicio");
const mongoose = require("mongoose");
require('dotenv').config();
// const fs = require('fs'); // Ya no necesitamos esto para leer archivos
// const path = require('path'); // Ya no necesitamos esto para manejar rutas de archivo de imagen

const router = express.Router();

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

// Ya no necesitamos getImageUrl ni encodeImageToBase64

// Iniciar nueva conversación
router.post("/chat/start-exercise", async (req, res) => {
  try {
    const { userId, exerciseId, userMessage } = req.body;
//Validación de datos 
    if (!userId || !exerciseId || !userMessage) {
      return res.status(400).json({ message: "Faltan datos: userId, exerciseId o userMessage." });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(exerciseId)) {
      return res.status(400).json({ message: "IDs de usuario o ejercicio inválidos." });
    }
//Búsqueda de ejercicio
    const ejercicio = await Ejercicio.findById(exerciseId);
    if (!ejercicio) {
      return res.status(404).json({ message: "Ejercicio no encontrado." });
    }

    // Cargamos el prompt del sistema desde el campo 'contextoTutor' del ejercicio
    let systemPrompt = ejercicio.contextoTutor;

    // Si el 'contextoTutor' está vacío en la base de datos, usamos un prompt por defecto
    if (!systemPrompt || systemPrompt.trim() === '') {
        console.warn(`'contextoTutor' vacío para el ejercicio ${exerciseId}. Usando prompt por defecto.`);
        systemPrompt = `Eres un tutor virtual experto en electrónica y muy útil. Responde siempre en español. Tienes que guiar al alumno en la resolución de problemas pero NO darles la solución directamente sino ayudarles a llegar a ella, con pistas o cuestiones para que puedan razonar y acertar ellos.`;
    }
console.log("System Prompt BASE cargado/usado:", systemPrompt.substring(0, 150) + '...'); // Muestra solo los primeros 150 caracteres para no llenar la consola

    // Añadimos la información específica del ejercicio al prompt del sistema
    // Añadimos la información específica del ejercicio al prompt del sistema
    systemPrompt += `\n\nEl ejercicio actual sobre el que te consultan es:\nTítulo: "${ejercicio.titulo}"\nEnunciado: "${ejercicio.enunciado}"`;

    // Las imágenes ya no se manejan aquí, el circuito se pondrá directamente en el enunciado si es necesario.

    const initialMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage } // Eliminamos 'images' de aquí
    ];

    const ollamaResponse = await axios.post(`${OLLAMA_API_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages: initialMessages,
      stream: false
    });

    const assistantResponseContent = ollamaResponse.data.message.content;

    const nuevaInteraccion = new Interaccion({
      usuario_id: userId,
      ejercicio_id: exerciseId,
      inicio: new Date(),
      fin: new Date(),
      conversacion: [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantResponseContent }
      ]
    });

    const savedInteraccion = await nuevaInteraccion.save();

    res.status(201).json({
      message: "Interacción iniciada y primer mensaje procesado por Ollama",
      interaccionId: savedInteraccion._id,
      initialMessage: assistantResponseContent,
      fullHistory: savedInteraccion.conversacion
    });

  } catch (error) {
    console.error("Error al iniciar nueva interacción/chat con Ollama:", error);
    if (error.response) {
      console.error("Respuesta de Ollama con error:", error.response.status, error.response.data);
      res.status(error.response.status).json({ message: "Error al comunicarse con Ollama.", error: error.response.data });
    } else if (error.request) {
      res.status(503).json({ message: "No se pudo conectar con el servidor Ollama.", error: error.message });
    } else {
      res.status(500).json({ message: "Error interno del servidor al iniciar interacción.", error: error.message });
    }
  }
});

// Continuar conversación
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

    // Nuevo: Cargamos el prompt del sistema desde el campo 'contextoTutor' del ejercicio
    let systemPrompt = ejercicio ? ejercicio.contextoTutor : null;

    // Si el 'contextoTutor' está vacío o el ejercicio no se encuentra, usamos un prompt por defecto
    if (!systemPrompt || systemPrompt.trim() === '') {
        console.warn(`'contextoTutor' vacío o ejercicio no encontrado para la interacción ${interaccionId}. Usando prompt por defecto.`);
        systemPrompt = `Eres un tutor virtual experto en electrónica y muy útil. Responde siempre en español. Tienes que guiar al alumno en la resolución de problemas pero NO darles la solución directamente sino ayudarles a llegar a ella, con pistas o cuestiones para que puedan razonar y acertar ellos.`;
    }
 console.log("System Prompt BASE cargado/usado:", systemPrompt.substring(0, 150) + '...'); // Muestra solo los primeros 150 caracteres para no llenar la consola
    // Añadimos la información específica del ejercicio al prompt del sistema
    systemPrompt += `\n\nEl ejercicio actual sobre el que te consultan es:\nTítulo: "${ejercicio ? ejercicio.titulo : 'No disponible'}"\nEnunciado: "${ejercicio ? ejercicio.enunciado : 'No disponible'}"`;

    // Las imágenes ya no se manejan aquí.

    interaccion.conversacion.push({ role: "user", content: userMessage });

    const messagesForOllama = [
      { role: "system", content: systemPrompt },
      // Aquí se sigue enviando el historial de la conversación.
      // Asegurarse de que el modelo de 'Interaccion' no espere un campo 'images' aquí
      ...interaccion.conversacion.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    const ollamaResponse = await axios.post(`${OLLAMA_API_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages: messagesForOllama,
      stream: false
    });

    const assistantResponseContent = ollamaResponse.data.message.content;

    interaccion.conversacion.push({ role: "assistant", content: assistantResponseContent });
    interaccion.fin = new Date();

    const updatedInteraccion = await interaccion.save();

    res.status(200).json({
      message: "Mensaje procesado y conversación actualizada por Ollama.",
      assistantMessage: assistantResponseContent,
      fullHistory: updatedInteraccion.conversacion
    });

  } catch (error) {
    console.error("Error al procesar mensaje de chat con Ollama:", error);
    if (error.response) {
      console.error("Respuesta de Ollama con error:", error.response.status, error.response.data);
      res.status(error.response.status).json({ message: "Error al comunicarse con Ollama.", error: error.response.data });
    } else if (error.request) {
      res.status(503).json({ message: "No se pudo conectar con el servidor Ollama.", error: error.message });
    } else {
      res.status(500).json({ message: "Error interno del servidor al procesar mensaje.", error: error.message });
    }
  }
});

module.exports = router;