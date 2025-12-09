// backend/authRoutes.js (o como lo llames)
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
  OAUTH_REDIRECT_URI = "http://localhost:9000/api/auth/cas/callback",
  OAUTH_SCOPES = "profile email",
  FRONTEND_BASE_URL = "http://localhost:5173",
  DEV_BYPASS_AUTH,
} = process.env;

// 🔹 Creamos aquí el cliente OAuth2 para CAS (ya no hace falta ./oauthClient)
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
 * 1. LOGIN CAS (ruta que llama el frontend)
 *    GET /api/auth/cas/login
 * =================================================================== */
router.get("/api/auth/cas/login", async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");

    // Ruta de retorno: o lo que pide el front, o el Home por defecto
    const returnTo = req.query.returnTo || `${FRONTEND_BASE_URL}/`;
    req.session.oauthState = state;
    req.session.returnTo = returnTo;

    // Construir URL de autorización CAS vía simple-oauth2
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

    // 1. Validación de seguridad
    if (!code || state !== req.session.oauthState) {
      console.error("[CAS ERROR] State no coincide o code no recibido.");
      return res.status(400).send("Solicitud inválida (state/code).");
    }

    // 2. Intercambio code -> access_token
    const tokenParams = {
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
    };

    const accessToken = await oauthClient.getToken(tokenParams);
    const rawToken = accessToken.token.access_token;

    // 3. Pedir perfil del usuario a CAS
    const profileResp = await fetch(`${CAS_BASE_URL}/oauth2.0/profile`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });

    if (!profileResp.ok) {
      throw new Error(
        `Fallo al obtener el perfil de CAS: ${profileResp.status} ${profileResp.statusText}`
      );
    }

    const profile = await profileResp.json();

    // 4. Normalizar atributos
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

    // 5. Upsert en Mongo
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

    // 6. Guardar usuario en la sesión
    req.session.user = {
      id: usuario._id.toString(),
      upvLogin: usuario.upvLogin,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      email: usuario.email,
      rol: usuario.rol || "alumno",
    };

    // 7. Redirigir al front:
    //    - Si había returnTo, ahí.
    //    - Si no, al Home "/".
    const goto = req.session.returnTo || `${FRONTEND_BASE_URL}/`;
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

/**
 * GET /api/auth/me
 * Usado por el frontend para saber si hay sesión activa.
 */
router.get("/api/auth/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

/**
 * GET /api/auth/logout
 * Cierra sesión local y en CAS.
 */
router.get("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    const url = new URL(`${CAS_BASE_URL}/logout`);
    url.searchParams.set("service", FRONTEND_BASE_URL);
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
 *    Solo si DEV_BYPASS_AUTH=true en el .env
 * =================================================================== */
router.post("/api/auth/dev-login", (req, res) => {
  if (DEV_BYPASS_AUTH !== "true") {
    return res
      .status(403)
      .json({ error: "DEV_BYPASS_AUTH deshabilitado en el servidor" });
  }

  const fakeUser = {
    id: "000000000000000000000000",
    upvLogin: "devuser",
    nombre: "Usuario",
    apellidos: "Demo",
    email: "devuser@upv.es",
    rol: "alumno",
  };

  req.session.user = fakeUser;
  return res.json({ ok: true, user: fakeUser });
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
