// backend/index.js
const express = require('express');
const mongoose = require('mongoose');
require("dotenv").config();

const cors = require("cors");

// Importar todas las rutas
const userRoutes = require("./routes/usuarios");
const ejerciciosRoutes = require("./routes/ejercicios"); // Correcto
const interaccionesRoutes = require("./routes/interacciones");
const ollamaChatRoutes = require("./routes/ollamaChatRoutes");
// const progresoRoutes = require("./routes/progresoRoutes");


const app = express();
const port = process.env.PORT || 9000;

app.use(cors());

// Configurar Express para servir archivos estáticos (imágenes, etc.)
app.use('/static', express.static('static'));

app.get("/", (req, res) => {
    res.send('Bienvenido a la API del Tutor Virtual');
});

// Middleware para parsear JSON en las solicitudes
app.use(express.json());

// Montar las rutas de la API
app.use('/api/usuarios', userRoutes);
app.use('/api/ejercicios', ejerciciosRoutes); // Montará `/` de ejercicios.js como `/api/ejercicios`
app.use('/api/interacciones', interaccionesRoutes);
app.use('/api/ollama', ollamaChatRoutes);
// app.use('/api/progreso', progresoRoutes);

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB Atlas'))
    .catch((error) => console.error('Error al conectar a MongoDB:', error));

app.listen(port, () => console.log(`Servidor escuchando en el puerto ${port}`));