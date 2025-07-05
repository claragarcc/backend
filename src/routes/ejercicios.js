// backend/routes/ejercicios.js
const express = require("express");
const Ejercicio = require("../models/ejercicio"); 

const router = express.Router();

// Obtener todos los ejercicios
router.get("/", async (req, res) => { 
    try {
        const data = await Ejercicio.find().sort({ _id: 1 });
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Crear un nuevo ejercicio
router.post("/", async (req, res) => { 
    try {
        const nuevoEjercicio = new Ejercicio(req.body);
        const data = await nuevoEjercicio.save();
        res.status(201).json(data);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});


// Obtener un ejercicio por ID
router.get("/:id", (req, res) => {
    const { id } = req.params;
    Ejercicio
   .findById(id)
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: "ejercicio no encontrado" }));
});

// Actualizar un ejercicio por ID
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { titulo, enunciado, imagen, asignatura, concepto, nivel, CA } = req.body;

  Ejercicio
   .updateOne({ _id: id }, { $set: { titulo, enunciado, imagen, asignatura, concepto, nivel, CA } })
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});

// Eliminar un ejercicio por ID
router.delete("/:id", (req, res) => {
    const { id } = req.params;
    Ejercicio
   .deleteOne({ _id: id })
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});

module.exports = router;