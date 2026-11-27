'use strict';

const router  = require('../router').Router();

const { ROLES, fail } = require('../config');
const { q, q1, qAll } = require('../db');
const { hashPwd }      = require('../auth');
const { auth }         = require('../middleware');
const { logActivity }  = require('../helpers');

// ── GET /api/users ──────────────────────────────────────────────
router.get('/', auth('users.manage'), async (_req, res) => {
  res.json(await qAll('SELECT id,username,name,role,active,must_change FROM users ORDER BY id'));
});

// ── POST /api/users ─────────────────────────────────────────────
router.post('/', auth('users.manage'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const username = String(b.username || '').trim().toLowerCase();
  if (!name) return fail(res, 'Nom requis');
  if (!/^[a-z0-9._-]{3,30}$/.test(username))
    return fail(res, "Identifiant : 3 à 30 caractères (lettres, chiffres . _ -)");
  if (String(b.password || '').length < 6)
    return fail(res, 'Mot de passe : 6 caractères minimum');
  if (!ROLES.includes(b.role)) return fail(res, 'Rôle invalide');
  try {
    await q(
      'INSERT INTO users(username,name,role,pwd,must_change) VALUES($1,$2,$3,$4,true)',
      [username, name, b.role, await hashPwd(String(b.password))]
    );
    logActivity(req.user, 'create_user', 'user', null, `${username} (${b.role})`);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e.code === '23505' ? 'Cet identifiant existe déjà' : 'Erreur création utilisateur');
  }
});

// ── PUT /api/users/:id ──────────────────────────────────────────
router.put('/:id', auth('users.manage'), async (req, res) => {
  const t = await q1('SELECT * FROM users WHERE id=$1', [+req.params.id]);
  if (!t) return fail(res, 'Utilisateur introuvable', 404);
  const b = req.body || {};
  const role   = b.role   !== undefined ? b.role   : t.role;
  const active = b.active !== undefined ? !!b.active : t.active;
  if (!ROLES.includes(role)) return fail(res, 'Rôle invalide');
  if (t.id === req.user.id && (role !== 'gerant' || !active))
    return fail(res, 'Vous ne pouvez pas modifier votre propre rôle ni vous désactiver');
  if (t.role === 'gerant' && (role !== 'gerant' || !active)) {
    const n = await q1(
      "SELECT COUNT(*)::int c FROM users WHERE role='gerant' AND active=true AND id!=$1", [t.id]
    );
    if (!n.c) return fail(res, 'Il doit rester au moins un gérant actif');
  }
  let pwd = t.pwd, mc = t.must_change;
  if (b.password !== undefined) {
    if (String(b.password).length < 6) return fail(res, 'Mot de passe : 6 caractères minimum');
    pwd = await hashPwd(String(b.password));
    mc = true;
  }
  await q('UPDATE users SET role=$1,active=$2,pwd=$3,must_change=$4 WHERE id=$5',
    [role, active, pwd, mc, t.id]);
  logActivity(req.user, 'update_user', 'user', t.id, `${t.username} — rôle:${role} actif:${active}`);
  res.json({ ok: true });
});

module.exports = router;
