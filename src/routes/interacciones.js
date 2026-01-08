// Interacciones
const express = require("express");
const Interaccion = require("../models/interaccion");
const mongoose = require("mongoose");
const { requireAuth } = require("../authRoutes");


const router = express.Router();

// 0. Ruta de test: GET /api/interacciones
router.get("/", async (_req, res) => {
  try {
    const interacciones = await Interaccion.find().sort({ fin: -1 }).limit(50);
    res.status(200).json(interacciones);
  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor." });
  }
});

// 1. Ruta para obtener todas las interacciones de un usuario
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido." });
    }

    // ✅ tu campo real es usuario_id (perfecto)
    const interacciones = await Interaccion.find({ usuario_id: userId }).sort({ fin: -1 });
    res.status(200).json(interacciones);
  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor." });
  }
});

// 2. Ruta para obtener la última interacción de un usuario con un ejercicio
// ✅ IMPORTANTE: va ANTES de "/:id"
router.get("/byExerciseAndUser/:exerciseId/:userId", async (req, res) => {
  try {
    const { exerciseId, userId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(exerciseId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res.status(400).json({ message: "IDs de ejercicio o usuario inválidos." });
    }

    const interaccion = await Interaccion.findOne({
      ejercicio_id: exerciseId,
      usuario_id: userId,
    }).sort({ fin: -1 });

    // ✅ Mejor devolver null (el front lo maneja más fácil)
    if (!interaccion) {
      return res.status(200).json(null);
    }

    res.status(200).json(interaccion);
  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor." });
  }
});

// 3. Ruta para obtener una interacción específica por su ID
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID de interacción inválido." });
    }

    const interaccion = await Interaccion.findById(id);
    if (!interaccion) {
      return res.status(404).json({ message: "Interacción no encontrada." });
    }

    // ✅ Solo dueño
    if (String(interaccion.usuario_id) !== String(req.session.user.id)) {
      return res.status(403).json({ message: "No autorizado." });
    }

    res.status(200).json(interaccion);
  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor." });
  }
});


// 4. Ruta para eliminar una interacción
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID de interacción inválido." });
    }

    const interaccion = await Interaccion.findById(id);
    if (!interaccion) {
      return res.status(404).json({ message: "Interacción no encontrada para eliminar" });
    }

    // ✅ Solo dueño
    if (String(interaccion.usuario_id) !== String(req.session.user.id)) {
      return res.status(403).json({ message: "No autorizado." });
    }

    await Interaccion.findByIdAndDelete(id);
    res.status(200).json({ message: "Interacción eliminada exitosamente" });
  } catch (error) {
    res.status(500).json({ message: "Error interno del servidor." });
  }
});


module.exports = router;
