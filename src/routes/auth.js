'use strict';
const router  = require('../router').Router();

const { fail, getPermissions } = require('../config');
const { q, q1, qAll }         = require('../db');
const { hashPwd, checkPwd, makeToken } = require('../auth');
const { auth, clientIp }      = require('../middleware');
const attempts                = require('../loginAttempts');
const { publicSettings, pub, logActivity } = require('../helpers');

/* ── POST /api/login ─────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const ip = clientIp(req);
  const { username = '', password = '' } = req.body || {};
  const uStr = String(username).trim(), pStr = String(password);
  if (await attempts.isBlocked(ip, uStr))
    return fail(res, 'Trop de tentatives. Réessayez dans quelques minutes.', 429);

  if (!uStr || !pStr) return fail(res, 'Identifiants requis');
  if (pStr.length > 200) return fail(res, 'Mot de passe invalide');

  const u = await q1('SELECT * FROM users WHERE username=$1 AND active=true', [uStr]);
  if (!u || !(await checkPwd(pStr, u.pwd))) {
    await attempts.recordFailure(ip, uStr);
    return fail(res, 'Identifiants incorrects', 401);
  }
  await attempts.clearFailures(ip, uStr);

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
