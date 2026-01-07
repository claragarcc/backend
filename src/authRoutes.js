// backend/authRoutes.js
const { Router } = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
const { AuthorizationCode } = require("simple-oauth2");
const Usuario = require("./models/usuario");
require("dotenv").config();

const router = Router();

const {
  CAS_BASE_URL = "https://casdev.upv.es/cas",
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI, // lo cogemos del .env
  OAUTH_SCOPES = "profile email",
  FRONTEND_BASE_URL, // lo cogemos del .env
  DEV_BYPASS_AUTH,
} = process.env;

// Cliente OAuth2 apuntando a CAS
const oauthClient = new AuthorizationCode({
  client: {
    id: OAUTH_CLIENT_ID,
    secret: OAUTH_CLIENT_SECRET,
  },
  auth: {
    tokenHost: CAS_BASE_URL,
    tokenPath: "/oauth2.0/accessToken",
    authorizePath: "/oauth2.0/authorize",
  },
  http: { json: true },
});

/* ===================================================================
 * 1. LOGIN CAS
 *    GET /api/auth/cas/login
 * =================================================================== */
router.get("/api/auth/cas/login", async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");

    // Ruta de retorno: o lo que pide el front, o Home por defecto
    const returnTo = req.query.returnTo || `${FRONTEND_BASE_URL || "/"}`;
    req.session.oauthState = state;
    req.session.returnTo = returnTo;

    const authorizationUri = oauthClient.authorizeURL({
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
      state,
    });

    return res.redirect(authorizationUri);
  } catch (err) {
    console.error("[CAS LOGIN ERROR]", err);
    return res.status(500).send("No se pudo iniciar el login con CAS.");
  }
});

/* ===================================================================
 * 2. CALLBACK CAS
 *    GET /api/auth/cas/callback
 * =================================================================== */
router.get("/api/auth/cas/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    // Validación de seguridad
    if (!code || state !== req.session.oauthState) {
      console.error("[CAS ERROR] State no coincide o code no recibido.");
      return res.status(400).send("Solicitud inválida (state/code).");
    }

    // code -> access_token
    const tokenParams = {
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
    };

    const accessToken = await oauthClient.getToken(tokenParams);
    const rawToken = accessToken.token.access_token;

    // Perfil
    const profileResp = await fetch(`${CAS_BASE_URL}/oauth2.0/profile`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });

    if (!profileResp.ok) {
      throw new Error(
        `Fallo al obtener el perfil de CAS: ${profileResp.status} ${profileResp.statusText}`
      );
    }

    const profile = await profileResp.json();

    // Normalizar atributos
    const attrs = profile.attributes || profile || {};
    const upvLogin = attrs.login || attrs.uid || profile.id;
    const email = attrs.email;
    const nombre = attrs.nombre || attrs.given_name || attrs.name;
    const apellidos = attrs.apellidos || attrs.family_name;
    const dni = attrs.dni;
    const grupos = Array.isArray(attrs.grupos) ? attrs.grupos : [];

    if (!upvLogin) {
      return res
        .status(500)
        .send("CAS no devolvió identificador de usuario (upvLogin).");
    }

    // Upsert en Mongo
    const usuario = await Usuario.findOneAndUpdate(
      { upvLogin },
      {
        $set: { email, nombre, apellidos, dni },
        $setOnInsert: { grupos },
      },
      { new: true, upsert: true }
    );

    usuario.lastLoginAt = new Date();
    await usuario.save();

    // Guardar usuario en sesión
    req.session.user = {
      id: usuario._id.toString(),
      upvLogin: usuario.upvLogin,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      email: usuario.email,
      rol: usuario.rol || "alumno",
      mode: "cas",
    };

    // Redirigir al front
    const goto = req.session.returnTo || `${FRONTEND_BASE_URL || "/"}`;
    delete req.session.oauthState;
    delete req.session.returnTo;

    return res.redirect(goto);
  } catch (err) {
    console.error("[CAS FATAL ERROR]", err);
    return res.status(500).send("Error en callback CAS. Revisa la consola.");
  }
});

/* ===================================================================
 * 3. ENDPOINTS DE SESIÓN
 * =================================================================== */
router.get("/api/auth/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

router.get("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    const url = new URL(`${CAS_BASE_URL}/logout`);
    if (FRONTEND_BASE_URL) url.searchParams.set("service", FRONTEND_BASE_URL);
    res.redirect(url.toString());
  });
});

/* ===================================================================
 * 4. MIDDLEWARE PARA RUTAS PROTEGIDAS
 * =================================================================== */
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "No autenticado" });
  }
  next();
}

/* ===================================================================
 * 5. MODO DEMO (sin CAS) → POST /api/auth/dev-login
 *    - Cada navegador obtiene un usuario demo distinto (persistido en Mongo)
 * =================================================================== */
router.post("/api/auth/dev-login", async (req, res) => {
  try {
    if (DEV_BYPASS_AUTH !== "true") {
      return res
        .status(403)
        .json({ error: "DEV_BYPASS_AUTH deshabilitado en el servidor" });
    }

    // Si ya hay sesión, no creamos otra
    if (req.session?.user?.id) {
      return res.json({ ok: true, user: req.session.user });
    }

    // demoKey viene del front (localStorage). Si no viene, generamos uno.
    const incoming = (req.body?.demoKey || "").toString().trim();
    const demoKey =
      incoming.length > 0 ? incoming.slice(0, 32) : crypto.randomBytes(16).toString("hex");

    const upvLogin = `demo_${demoKey}`;

    // Creamos/actualizamos un usuario demo en Mongo -> _id real (distinto por navegador)
    const usuario = await Usuario.findOneAndUpdate(
      { upvLogin },
      {
        $set: {
          nombre: "Usuario",
          apellidos: "Demo",
          email: `${upvLogin}@demo.local`,
        },
      },
      { new: true, upsert: true }
    );

    usuario.lastLoginAt = new Date();
    await usuario.save();

    req.session.user = {
      id: usuario._id.toString(),
      upvLogin: usuario.upvLogin,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      email: usuario.email,
      rol: usuario.rol || "alumno",
      mode: "demo",
    };

    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("[DEV LOGIN ERROR]", err);
    return res.status(500).json({ error: "Error creando sesión demo" });
  }
});

router.post("/api/auth/dev-logout", (req, res) => {
  if (DEV_BYPASS_AUTH !== "true") {
    return res
      .status(403)
      .json({ error: "DEV_BYPASS_AUTH deshabilitado en el servidor" });
  }
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = {
  router,
  requireAuth,
};
