'use strict';
const router  = require('../router').Router();

const { fail }         = require('../config');
const { q, q1, qAll }  = require('../db');
const { auth }         = require('../middleware');
const { logActivity }  = require('../helpers');

/* ── GET /api/catalog ────────────────────────────────────────── */
router.get('/', auth(), async (_req, res) =>
  res.json(await qAll('SELECT id,name,price,price_express,icon,category FROM catalog WHERE active=true ORDER BY category,name')));

/* ── POST /api/catalog ───────────────────────────────────────── */
router.post('/', auth('catalog.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim(), price = Math.round(+req.body?.price);
  const price_express = Math.round(+req.body?.price_express || 0);
  const icon = String(req.body?.icon || '🧺').trim().slice(0, 4) || '🧺';
  if (!name || !(price >= 0)) return fail(res, 'Nom et prix valides requis');
  const category = String(req.body?.category || 'Divers').trim().slice(0, 50) || 'Divers';
  await q('INSERT INTO catalog(name,price,price_express,icon,category) VALUES($1,$2,$3,$4,$5)', [name, price, price_express, icon, category]);
  logActivity(req.user, 'create_catalog', 'catalog', null, `${name} — ${price} FCFA`);
  res.json({ ok: true });
});

/* ── PUT /api/catalog/:id ────────────────────────────────────── */
router.put('/:id', auth('catalog.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim(), price = Math.round(+req.body?.price);
  const price_express = Math.round(+req.body?.price_express || 0);
  const icon = String(req.body?.icon || '🧺').trim().slice(0, 4) || '🧺';
  if (!name || !(price >= 0)) return fail(res, 'Nom et prix valides requis');
  const category = String(req.body?.category || 'Divers').trim().slice(0, 50) || 'Divers';
  const old = await q1('SELECT price, price_express FROM catalog WHERE id=$1', [+req.params.id]);
  if (old && (old.price !== price || (old.price_express || 0) !== price_express)) {
    await q('INSERT INTO price_history(catalog_id,old_price,new_price,old_price_express,new_price_express,changed_by) VALUES($1,$2,$3,$4,$5,$6)',
      [+req.params.id, old.price, price, old.price_express || 0, price_express, req.user.id]);
  }
  await q('UPDATE catalog SET name=$1,price=$2,price_express=$3,icon=$4,category=$5 WHERE id=$6', [name, price, price_express, icon, category, +req.params.id]);
  logActivity(req.user, 'update_catalog', 'catalog', +req.params.id, `${name} — ${price} FCFA`);
  res.json({ ok: true });
});

/* ── GET /api/catalog/:id/price-history ──────────────────────── */
router.get('/:id/price-history', auth('catalog.manage', 'stats.view'), async (req, res) => {
  const rows = await qAll(
    `SELECT ph.id, ph.old_price, ph.new_price, ph.old_price_express, ph.new_price_express,
            ph.changed_at, u.username as changed_by_name
     FROM price_history ph LEFT JOIN users u ON u.id = ph.changed_by
     WHERE ph.catalog_id = $1 ORDER BY ph.changed_at DESC LIMIT 50`,
    [+req.params.id]
  );
  res.json(rows);
});

/* ── DELETE /api/catalog/:id ─────────────────────────────────── */
router.delete('/:id', auth('catalog.manage'), async (req, res) => {
  await q('UPDATE catalog SET active=false WHERE id=$1', [+req.params.id]);
  logActivity(req.user, 'delete_catalog', 'catalog', +req.params.id, '');
  res.json({ ok: true });
});

module.exports = router;
