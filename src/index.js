// backend/index.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");

// Rutas de tu app
const userRoutes = require("./routes/usuarios");
const ejerciciosRoutes = require("./routes/ejercicios");
const interaccionesRoutes = require("./routes/interacciones");
const ollamaChatRoutes = require("./routes/ollamaChatRoutes");
const resultadoRoutes = require("./routes/resultados");
const progresoRoutes = require("./routes/progresoRoutes");

// 🔹 Router de autenticación (CAS + modo demo)
const { router: authRouter, requireAuth } = require("./authRoutes");

const app = express();
const port = process.env.PORT || 9000;

// ====== CORS (imprescindible para cookies de sesión en el front) ======
app.use(
  cors({
    origin: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
    credentials: true,
  })
);

// ====== Middlewares base ======
app.use(express.json());
app.use("/static", express.static("static"));

// ====== Conexión a Mongo ======
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Conectado a MongoDB Atlas"))
  .catch((error) => console.error("Error al conectar a MongoDB:", error));

// ====== Sesión (persistida en Mongo) ======
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cambia-esto-por-una-clave-segura",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      secure: false,       // En producción con HTTPS: true
      sameSite: "lax",     // Si front y back están en dominios distintos con HTTPS, usa "none"
    },
  })
);

// ====== Rutas públicas básicas ======
app.get("/", (_req, res) => {
  res.send("Bienvenido a la API del Tutor Virtual");
});

// ====== Rutas de AUTENTICACIÓN (CAS real + modo demo)
// Todas las rutas definidas en authRoutes.js:
//   GET  /api/auth/cas/login
//   GET  /api/auth/cas/callback
//   GET  /api/auth/me
//   GET  /api/auth/logout
//   POST /api/auth/dev-login   (si DEV_BYPASS_AUTH=true)
//   POST /api/auth/dev-logout  (si DEV_BYPASS_AUTH=true)
app.use(authRouter);

// ====== Rutas de la API (negocio) ======
app.use("/api/usuarios", userRoutes);
app.use("/api/ejercicios", ejerciciosRoutes);
app.use("/api/interacciones", interaccionesRoutes);
app.use("/api/ollama", ollamaChatRoutes);
app.use("/api/progreso", progresoRoutes);
app.use("/api/resultados", resultadoRoutes);

// ====== Ejemplo de ruta PROTEGIDA (necesita sesión válida) ======
app.post("/api/llm/query", requireAuth, (req, res) => {
  // Si llega aquí, req.session.user existe
  res.json({ ok: true, user: req.session.user });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
