const express = require("express");
const userSchema = require("../models/usuario");

const router = express.Router();

router.post("/usuarios", (req, res) => {
   const nuevoUsuario = new Usuario(req.body);
   nuevoUsuario
   .save()
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});


//get all users
router.get("/usuarios", (req, res) => {
    Usuario
   .find()
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});

//get a user
router.get("/usuarios/:id", (req, res) => {
    const { id } = req.params;
    Usuario
   .findById(id)
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});

//update a user
router.put("/usuarios/:id", (req, res) => {
    const { id } = req.params;
    const { loguin_usuario } = req.body;
    Usuario
   .updateOne({ _id: id}, {$set: {loguin_usuario}})
   .then((data) => res.json(data))
   .catch((error) => res.json({ message: error }));
});



module.exports = router;

