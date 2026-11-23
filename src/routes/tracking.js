const { Router } = require('express');
const { q1, qAll } = require('../db');
const { fail } = require('../config');
const { publicSettings } = require('../helpers');

const router = Router();

/* GET /api/track/:token — public order tracking (no auth) */
router.get('/:token', async (req, res) => {
  const token = String(req.params.token).trim();
  if (!token || token.length > 24) return fail(res, 'Lien invalide', 404);
  const o = await q1('SELECT * FROM orders WHERE track_token=$1', [token]);
  if (!o) return fail(res, 'Commande introuvable', 404);
  if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
  o.weight = o.weight ? Number(o.weight) : null;
  const payments = await qAll('SELECT amount,method,created_at FROM payments WHERE order_id=$1 ORDER BY id', [o.id]);
  o.paid_total = payments.reduce((s, p) => s + p.amount, 0);
  o.balance = o.total - o.paid_total;
  const history = await qAll('SELECT new_status,changed_at FROM status_history WHERE order_id=$1 ORDER BY id', [o.id]);
  const settings = await publicSettings();
  res.json({
    shop_name: settings.shop_name, shop_phone: settings.shop_phone, shop_logo: settings.invoice_logo,
    code: o.code, client_name: o.client_name, status: o.status,
    items: o.items, type: o.type, weight: o.weight, price_kg: o.price_kg, kilo_items: o.kilo_items,
    subtotal: o.subtotal, discount: o.discount, total: o.total,
    paid_total: o.paid_total, balance: o.balance, promise_date: o.promise_date,
    created_at: o.created_at, delivered_at: o.delivered_at,
    history: history.map(h => ({ status: h.new_status, at: h.changed_at }))
  });
});

module.exports = router;
