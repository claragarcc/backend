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

        const interaccion = await Interaccion.findById(interaccionId);
        const conversacionTexto = interaccion 
            ? interaccion.conversacion.map(m => `${m.role}: ${m.content}`).join('\n') 
            : "Conversación no disponible.";

        const promptParaOllama = `
            Un estudiante ha finalizado un ejercicio.
            Esta fue su conversación con el tutor:
            ---
            ${conversacionTexto}
            ---
            Basado en esta conversación, genera un objeto JSON con dos claves:
            - "analisis": Un resumen muy corto de lo que hizo el estudiante.
            - "consejo": Un consejo muy breve y directo.
            Responde únicamente con el objeto JSON.
        `;

        const ollamaResponse = await axios.post(`${process.env.OLLAMA_API_URL}/api/chat`, {
            model: process.env.OLLAMA_MODEL,
            messages: [{ role: "user", content: promptParaOllama }],
            format: "json",
            stream: false
        });
        const analisisIA = JSON.parse(ollamaResponse.data.message.content);

        const nuevoResultado = new Resultado({
            usuario_id: userId,
            ejercicio_id: exerciseId,
            interaccion_id: interaccionId,
            resueltoALaPrimera: resueltoALaPrimera,
            analisisIA: analisisIA.analisis,
            consejoIA: analisisIA.consejo
        });
        await nuevoResultado.save();

        res.status(200).json({ message: "Resultado guardado con éxito." });
    } catch (error) {
        console.error("Error al finalizar resultado:", error);
        res.status(500).json({ message: "Error del servidor al finalizar resultado." });
    }
});
// --- NUEVA RUTA AÑADIDA ---
// Devuelve una lista de los IDs de los ejercicios que un usuario ha completado.
router.get("/completed/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Buscamos en los resultados todos los documentos de este usuario
        const userResults = await Resultado.find({ usuario_id: userId });
        
        // Creamos una lista solo con los IDs de los ejercicios, sin repetidos.
        const completedExerciseIds = [...new Set(userResults.map(r => r.ejercicio_id.toString()))];
        
        res.status(200).json(completedExerciseIds);

    } catch (error) {
        console.error("Error al obtener ejercicios completados:", error);
        res.status(500).json({ message: "Error del servidor." });
    }
});



// Esta línea es crucial para que el archivo sea un router válido
module.exports = router;