const express = require("express");
const Interaccion = require("../models/interaccion");
const mongoose = require("mongoose");

const router = express.Router();

// 1. Ruta para obtener todas las interacciones de un usuario
// GET /api/interacciones/user/:userId
router.get("/user/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "ID de usuario inválido." });
        }
        const interacciones = await Interaccion.find({ usuario_id: userId }).sort({ fin: -1 });
        res.status(200).json(interacciones);
    } catch (error) {
        console.error("Error al obtener interacciones por usuario:", error);
        res.status(500).json({ message: "Error interno del servidor.", error: error.message });
    }
});

// 2. Ruta para obtener una interacción específica por ID
// GET /api/interacciones/:id
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "ID de interacción inválido." });
        }
        const interaccion = await Interaccion.findById(id);
        if (!interaccion) {
            return res.status(404).json({ message: "Interacción no encontrada." });
        }
        res.status(200).json(interaccion);
    } catch (error) {
        console.error("Error al obtener interacción por ID:", error);
        res.status(500).json({ message: "Error interno del servidor.", error: error.message });
    }
});

// 3. Obtener una interacción por ejercicio y usuario
// GET /api/interacciones/byExerciseAndUser/:exerciseId/:userId
router.get("/byExerciseAndUser/:exerciseId/:userId", async (req, res) => {
    try {
        const { exerciseId, userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(exerciseId) || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "IDs de ejercicio o usuario inválidos." });
        }

        const interaccion = await Interaccion.findOne({
            ejercicio_id: exerciseId,
            usuario_id: userId
        }).sort({ fin: -1 });

        if (!interaccion) {
            // Es normal no encontrar una, así que devolvemos un mensaje claro en lugar de un error 404.
            return res.status(200).json({ message: "No se encontró interacción para este ejercicio y usuario." });
        }
        res.status(200).json(interaccion);
    } catch (error) {
        console.error("Error al buscar interacción por ejercicio y usuario:", error);
        res.status(500).json({ message: "Error interno del servidor.", error: error.message });
    }
});

// 4. Eliminar una interacción
// DELETE /api/interacciones/:id
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "ID de interacción inválido." });
        }
        const data = await Interaccion.findByIdAndDelete(id);

        if (!data) {
            return res.status(404).json({ message: "Interacción no encontrada para eliminar" });
        }
        res.status(200).json({ message: "Interacción eliminada exitosamente" });
    } catch (error) {
        console.error("Error al eliminar interacción:", error);
        res.status(500).json({ message: "Error interno del servidor al eliminar interacción" });
    }
});

module.exports = router;