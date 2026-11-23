const { Router } = require('express');
const router = Router();
const { fail } = require('../config');
const { setS, logActivity, publicSettings } = require('../helpers');

// PUT /api/settings
router.put('/', async (req, res) => {
  const b = req.body || {};
  const kp = Math.round(+b.kilo_price), dd = Math.round(+b.default_delay);
  const mdp = Math.round(+b.max_discount_percent);
  if (!(kp > 0)) return fail(res, 'Tarif kilo invalide');
  if (!(dd >= 0 && dd <= 30)) return fail(res, 'Délai invalide (0 à 30 jours)');
  if (!(mdp >= 0 && mdp <= 100)) return fail(res, 'Plafond remise invalide (0 à 100 %)');
  await setS('shop_name', String(b.shop_name || 'Light Pressing').trim().slice(0, 80));
  await setS('shop_address', String(b.shop_address || '').trim().slice(0, 160));
  await setS('shop_phone', String(b.shop_phone || '').trim().slice(0, 40));
  await setS('shop_niu', String(b.shop_niu || '').trim().slice(0, 40));
  await setS('kilo_price', kp);
  await setS('default_delay', dd);
  await setS('max_discount_percent', mdp);
  const ifmt = String(b.invoice_format || 'A6');
  if (!['A4', 'A5', 'A6'].includes(ifmt)) return fail(res, 'Format facture invalide (A4/A5/A6)');
  await setS('invoice_format', ifmt);
  await setS('invoice_header', String(b.invoice_header || '').trim().slice(0, 500));
  await setS('invoice_footer', String(b.invoice_footer || '').trim().slice(0, 300));
  logActivity(req.user, 'update_settings', 'settings', null, 'Paramètres modifiés');
  res.json(await publicSettings());
});

// POST /api/settings/logo
router.post('/logo', async (req, res) => {
  const logo = String(req.body?.logo || '').trim();
  if (logo && !logo.startsWith('data:image/')) return fail(res, 'Format logo invalide (data:image/… attendu)');
  if (logo.length > 1500000) return fail(res, 'Logo trop volumineux (max ~1 Mo)');
  await setS('invoice_logo', logo);
  res.json({ ok: true });
});

// DELETE /api/settings/logo
router.delete('/logo', async (req, res) => {
  await setS('invoice_logo', '');
  res.json({ ok: true });
});

module.exports = router;
