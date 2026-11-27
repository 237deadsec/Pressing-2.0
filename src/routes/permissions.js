const { Router } = require('../router');
const { q } = require('../db');
const { fail, ROLES, DEFAULT_PERMISSIONS, getPermissions } = require('../config');
const { loadPermissions, ensureFreshPermissions, logActivity } = require('../helpers');
const { auth } = require('../middleware');

const router = Router();

/* GET / — current permissions */
router.get('/', auth('users.manage'), async (req, res) => {
  await ensureFreshPermissions();
  res.json({ permissions: getPermissions(), defaults: DEFAULT_PERMISSIONS, roles: ROLES });
});

/* PUT / — update permissions */
router.put('/', auth('users.manage'), async (req, res) => {
  const custom = req.body;
  if (!custom || typeof custom !== 'object') return fail(res, 'Données invalides');
  for (const role of Object.keys(custom)) {
    if (!ROLES.includes(role)) return fail(res, `Rôle inconnu : ${role}`);
    if (typeof custom[role] !== 'object') return fail(res, `Permissions invalides pour ${role}`);
    for (const key of Object.keys(custom[role])) {
      if (!(key in DEFAULT_PERMISSIONS.gerant)) return fail(res, `Permission inconnue : ${key}`);
      if (typeof custom[role][key] !== 'boolean') return fail(res, `Valeur invalide pour ${key}`);
    }
  }
  await q("INSERT INTO settings(key,value) VALUES('permissions',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [JSON.stringify(custom)]);
  await loadPermissions();
  logActivity(req.user, 'update_permissions', 'settings', null, 'Permissions modifiées');
  res.json({ ok: true, permissions: getPermissions() });
});

module.exports = router;
