'use strict';

const { readToken } = require('./auth');
const { q1 }        = require('./db');
const { fail, hasPermission } = require('./config');

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

// ── Rate-limiting state (login brute-force) ─────────────────────
const fails = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) {
    if (v.until < now && v.n === 0) fails.delete(k);
  }
}, 600e3);

module.exports = { auth, fails };
