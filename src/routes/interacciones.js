const express = require("express");
const Interaccion = require("../models/interaccion");
const mongoose = require("mongoose");

const router = express.Router();

// 1. Ruta para obtener todas las interacciones de un usuario
router.get("/user/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "ID de usuario inválido." });
        }
        const interacciones = await Interaccion.find({ usuario_id: userId }).sort({ fin: -1 });
        res.status(200).json(interacciones);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// 2. Ruta para obtener una interacción específica por su ID
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
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// 3. Ruta para obtener la última interacción de un usuario con un ejercicio
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
            return res.status(200).json({ message: "No se encontró interacción para este ejercicio y usuario." });
        }
        res.status(200).json(interaccion);
    } catch (error) {
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// 4. Ruta para eliminar una interacción
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
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

module.exports = router;