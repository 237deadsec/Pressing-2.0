const { Router } = require('express');
const { q, qAll } = require('../db');
const { fail, PAYMENT_METHODS } = require('../config');
const { orderWithPayments, logActivity } = require('../helpers');
const { auth } = require('../middleware');

const router = Router();

/* POST /:id/pay — partial payment */
router.post('/:id/pay', auth(), async (req, res) => {
  const method = req.body?.method;
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 'Mode de règlement invalide');
  const amount = Math.round(+req.body?.amount);
  if (!(amount > 0)) return fail(res, 'Montant invalide');
  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  if (o.status === 'annule') return fail(res, 'Commande annulée');
  if (o.balance <= 0) return fail(res, 'Commande déjà intégralement réglée');
  const actual = Math.min(amount, o.balance);
  await q('INSERT INTO payments(order_id,amount,method,created_at,created_by) VALUES($1,$2,$3,$4,$5)',
    [o.id, actual, method, new Date().toISOString(), req.user.username]);
  logActivity(req.user, 'payment', 'order', o.id, `${o.code} — ${actual} FCFA (${method})`);
  res.json(await orderWithPayments(o.id));
});

/* GET /:id/payments — list payments for an order */
router.get('/:id/payments', auth(), async (req, res) => {
  const payments = await qAll('SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [+req.params.id]);
  res.json(payments);
});

module.exports = router;
