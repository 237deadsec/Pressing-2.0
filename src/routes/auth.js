'use strict';
const router  = require('../router').Router();

const { fail, getPermissions } = require('../config');
const { q, q1, qAll }         = require('../db');
const { hashPwd, checkPwd, makeToken } = require('../auth');
const { auth, fails }         = require('../middleware');
const { publicSettings, pub, logActivity } = require('../helpers');

/* ── POST /api/login ─────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return fail(res, 'Trop de tentatives. Réessayez dans quelques minutes.', 429);

  const { username = '', password = '' } = req.body || {};
  const uStr = String(username).trim(), pStr = String(password);
  if (!uStr || !pStr) return fail(res, 'Identifiants requis');
  if (pStr.length > 200) return fail(res, 'Mot de passe invalide');

  const u = await q1('SELECT * FROM users WHERE username=$1 AND active=true', [uStr]);
  if (!u || !(await checkPwd(pStr, u.pwd))) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; }
    fails.set(ip, f);
    if (uStr) { const uf = fails.get('u:' + uStr) || { n: 0, until: 0 }; uf.n++; if (uf.n >= 5) { uf.until = Date.now() + 5 * 60e3; uf.n = 0; } fails.set('u:' + uStr, uf); }
    return fail(res, 'Identifiants incorrects', 401);
  }
  fails.delete(ip);
  fails.delete('u:' + uStr);

  res.setHeader('Set-Cookie', `pp_session=${makeToken(u)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  logActivity(u, 'login', 'user', u.id, `Connexion depuis ${ip}`);
  res.json({ user: pub(u) });
});

/* ── POST /api/logout ────────────────────────────────────────── */
router.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'pp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

/* ── GET /api/bootstrap ──────────────────────────────────────── */
router.get('/bootstrap', auth(), async (req, res) => {
  const perms = getPermissions()[req.user.role] || {};
  res.json({
    user: pub(req.user), settings: await publicSettings(),
    catalog: await qAll('SELECT id,name,price,price_express,icon,category FROM catalog WHERE active=true ORDER BY category,name'),
    permissions: perms
  });
});

/* ── POST /api/password ──────────────────────────────────────── */
router.post('/password', auth(), async (req, res) => {
  const { current = '', password = '' } = req.body || {};
  if (String(password).length > 200) return fail(res, 'Mot de passe trop long');
  const u = await q1('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await checkPwd(String(current), u.pwd))) return fail(res, 'Mot de passe actuel incorrect');
  if (String(password).length < 6) return fail(res, 'Nouveau mot de passe : 6 caractères minimum');
  if (password === current) return fail(res, 'Choisissez un mot de passe différent');
  await q('UPDATE users SET pwd=$1,must_change=false WHERE id=$2', [await hashPwd(String(password)), u.id]);
  res.json({ ok: true });
});

module.exports = router;
