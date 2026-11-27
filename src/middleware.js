'use strict';

const { readToken } = require('./auth');
const { q1 }        = require('./db');
const { fail, hasPermission } = require('./config');
const { ensureFreshPermissions } = require('./helpers');

const MUST_CHANGE_ALLOWED = new Set(['/api/bootstrap', '/api/password']);

// ── Auth middleware factory ─────────────────────────────────────
// Usage: auth()                – any authenticated user
//        auth('gerant')        – role-based
//        auth('catalog.manage') – permission-based (contains '.')
const auth = (...rolesOrPerms) => async (req, res, next) => {
  const c = {};
  (req.headers.cookie || '').split(';').forEach((x) => {
    const i = x.indexOf('=');
    if (i > 0) c[x.slice(0, i).trim()] = x.slice(i + 1).trim();
  });
  const d = readToken(c.pp_session);
  if (!d) return fail(res, 'Non authentifié', 401);

  const u = await q1(
    'SELECT id,username,name,role,must_change FROM users WHERE id=$1 AND active=true',
    [d.id]
  );
  if (!u) return fail(res, 'Non authentifié', 401);
  // Mot de passe initial ou réinitialisé : tant qu'il n'est pas changé, seules
  // la lecture du profil et le changement de mot de passe sont permis.
  // Avant, cette règle n'existait que dans l'interface.
  if (u.must_change && !MUST_CHANGE_ALLOWED.has(req.baseUrl + req.path))
    return res.status(403).json({ error: 'Changez votre mot de passe avant de continuer', must_change: true });
  await ensureFreshPermissions();

  if (rolesOrPerms.length) {
    const perms = rolesOrPerms.filter((x) => x.includes('.'));
    const roles = rolesOrPerms.filter((x) => !x.includes('.'));
    if (perms.length) {
      if (!perms.some((p) => hasPermission(u.role, p)))
        return fail(res, 'Accès refusé', 403);
    } else if (roles.length) {
      if (!roles.includes(u.role))
        return fail(res, 'Accès refusé', 403);
    }
  }
  req.user = u;
  next();
};

// ── Adresse IP du client ────────────────────────────────────────
// Maintenant que le blocage par IP est partagé entre instances, une
// mauvaise IP (celle d'un proxy, commune à tout le monde) bloquerait tous
// les utilisateurs d'un coup. Sur Vercel on lit donc l'en-tête documenté
// x-vercel-forwarded-for (IP publique du client).
// Ailleurs, on garde req.ip (réglé par « trust proxy » dans server.js).
function clientIp(req) {
  if (process.env.VERCEL) {
    const h = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'];
    if (h) return String(h).split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

module.exports = { auth, clientIp };
