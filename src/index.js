// backend/index.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const path = require("path");



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
const port = process.env.PORT || 80;

// ====== CORS (imprescindible para cookies de sesión en el front) ======
app.use(
  cors({
    origin: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
    credentials: true,
  })
);

// ====== Middlewares base ======
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "static"), { fallthrough: false }));

// ====== Conexión a Mongo ======
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Conectado a MongoDB Atlas"))
  .catch((error) => console.error("Error al conectar a MongoDB:", error));

// ====== Sesión (persistida en Mongo) ======


app.set("trust proxy", 1); // trust first proxy
const isProd = process.env.NODE_ENV === "production";
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cambia-esto-por-una-clave-segura",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    },
  })
);

// ====== Healthcheck (en vez de usar "/") ======
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ====== Rutas de AUTENTICACIÓN (CAS real + modo demo) ======
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
  res.json({ ok: true, user: req.session.user });
});

// ====== Servir FRONTEND (React build) ======
const frontendDist = path.join(__dirname, "..","..", "frontend", "dist");

app.use(express.static(frontendDist));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const fs = require("fs");

const staticDir = path.join(__dirname, "static");
console.log("STATIC DIR =", staticDir);
console.log("STATIC EXISTS =", fs.existsSync(staticDir));
if (fs.existsSync(staticDir)) {
  console.log("STATIC FILES =", fs.readdirSync(staticDir).slice(0, 50));
}

// ====== Arranque servidor ======
app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
