// backend/index.js

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

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
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
console.log("FRONTEND DIST =", frontendDist);


// 1) Assets (JS/CSS) con caché largo (llevan hash)
// 2) index.html SIN caché (para que coja SIEMPRE el build nuevo)
app.use(
  express.static(frontendDist, {
    immutable: true,
    maxAge: "365d",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// SPA fallback (cualquier ruta que NO sea /api -> index.html SIN caché)
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
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
  const axios = require("axios");

async function warmupOllama() {
  const url = process.env.OLLAMA_API_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:latest";
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "2h";

  try {
    console.log("[OLLAMA] Warmup...");
    await axios.post(
      `${url}/api/chat`,
      {
        model,
        stream: false,
        keep_alive: keepAlive,
        messages: [
          { role: "system", content: "Responde solo con OK." },
          { role: "user", content: "OK" },
        ],
        options: { num_predict: 1, temperature: 0 },
      },
      { timeout: 0 }
    );
    console.log("[OLLAMA] Warmup OK");
  } catch (e) {
    console.warn("[OLLAMA] Warmup FAILED:", e?.message || e);
  }
}

warmupOllama();

  console.log(`Servidor escuchando en el puerto ${port}`);
});
