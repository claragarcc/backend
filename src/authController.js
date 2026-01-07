// backend/authController.js
const crypto = require("crypto");
const fetch = require("node-fetch");
const { AuthorizationCode } = require("simple-oauth2");
const Usuario = require("./models/usuario");

const {
  CAS_BASE_URL = "https://casdev.upv.es/cas",
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_URI = "http://localhost:80/api/auth/cas/callback",
  OAUTH_SCOPES = "profile email",
  FRONTEND_BASE_URL = "http://localhost:5173",
} = process.env;

// Cliente OAuth2 apuntando a CAS
const oauthClient = new AuthorizationCode({
  client: { id: OAUTH_CLIENT_ID, secret: OAUTH_CLIENT_SECRET },
  auth: {
    tokenHost: CAS_BASE_URL,
    tokenPath: "/oauth2.0/accessToken",
    authorizePath: "/oauth2.0/authorize",
  },
  http: { json: true },
});

//
// 1) Iniciar login CAS (flujo normal con SSO)
//
async function handleLoginRedirect(req, res) {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const returnTo = req.query.returnTo || `${FRONTEND_BASE_URL}/`;
    req.session.oauthState = state;
    req.session.returnTo = returnTo;

    const authorizationUri = oauthClient.authorizeURL({
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
      state,
    });

    return res.redirect(authorizationUri);
  } catch (err) {
    console.error("handleLoginRedirect error:", err);
    return res.status(500).send("No se pudo iniciar el login con CAS.");
  }
}

//
// 2) Callback de CAS: code -> token -> perfil -> sesión
//
async function handleCASCallback(req, res) {
  try {
    const { code, state } = req.query;

    // 1) Validaciones básicas
    if (!code || state !== req.session.oauthState) {
      return res.status(400).send("Solicitud inválida (state/code).");
    }

    // 2) Intercambio code -> access_token (simple-oauth2)
    const tokenParams = {
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
    };
    const accessToken = await oauthClient.getToken(tokenParams);
    const rawToken = accessToken.token.access_token;

    // 3) Perfil de usuario en CAS
    const profileResp = await fetch(`${CAS_BASE_URL}/oauth2.0/profile`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    if (!profileResp.ok) {
      const t = await profileResp.text();
      throw new Error(`Perfil CAS HTTP ${profileResp.status}: ${t}`);
    }
    const profile = await profileResp.json();

    // 4) Normalización de atributos
    const attrs = profile.attributes || profile || {};
    const upvLogin = attrs.login || attrs.uid || profile.id;
    const email = attrs.email || null;
    const nombre = attrs.nombre || attrs.given_name || attrs.name || null;
    const apellidos = attrs.apellidos || attrs.family_name || null;
    const dni = attrs.dni || null;
    const grupos = Array.isArray(attrs.grupos) ? attrs.grupos : [];

    if (!upvLogin) {
      return res.status(500).send("CAS no devolvió identificador de usuario.");
    }

    // 5) Upsert en tu colección Usuarios
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

    // 6) Crear sesión de aplicación (cookie)
    req.session.user = {
      id: usuario._id.toString(),
      upvLogin: usuario.upvLogin,
      nombre: usuario.nombre,
      apellidos: usuario.apellidos,
      email: usuario.email,
      rol: usuario.rol || "alumno",
    };

    // 7) Redirección final
    //    - Si venía con ?returnTo=... vuelve ahí.
    //    - Si no, va al Home "/".
    const goto = req.session.returnTo || `${FRONTEND_BASE_URL}/`;
    delete req.session.oauthState;
    delete req.session.returnTo;

    return res.redirect(goto);
  } catch (err) {
    console.error("handleCASCallback error:", err);
    return res.status(500).send("Error procesando el callback de CAS.");
  }
}

//
// 3) Middleware de protección para APIs privadas
//
function protect(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "No autenticado" });
  }
  next();
}

//
// 4) Endpoint /api/auth/me → quién soy (para el frontend)
//
function me(req, res) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
}

//
// 5) Logout real (cerrar sesión en tu app y en CAS)
//
function logout(req, res) {
  req.session.destroy(() => {
    const url = new URL(`${CAS_BASE_URL}/logout`);
    url.searchParams.set("service", FRONTEND_BASE_URL);
    res.redirect(url.toString());
  });
}

//
// 6) MODO DEMO: login / logout sin CAS (para desarrollo y máquina virtual)
//    Solo se activa si DEV_BYPASS_AUTH=true en el .env
//
async function devLogin(req, res) {
  if (process.env.DEV_BYPASS_AUTH !== "true") {
    return res.status(403).json({ error: "DEV_BYPASS_AUTH deshabilitado" });
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
}

function devLogout(req, res) {
  if (process.env.DEV_BYPASS_AUTH !== "true") {
    return res.status(403).json({ error: "DEV_BYPASS_AUTH deshabilitado" });
  }
  req.session.destroy(() => res.json({ ok: true }));
}

module.exports = {
  handleLoginRedirect,
  handleCASCallback,
  protect,
  me,
  logout,
  devLogin,
  devLogout,
};
