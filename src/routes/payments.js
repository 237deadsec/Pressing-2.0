const { Router } = require('../router');
const { pool, qAll } = require('../db');
const { fail, PAYMENT_METHODS } = require('../config');
const { orderWithPayments, logActivity } = require('../helpers');
const { auth } = require('../middleware');

const router = Router();

/* POST /:id/pay — partial payment */
router.post('/:id/pay', auth('payments.create'), async (req, res) => {
  const method = req.body?.method;
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 'Mode de règlement invalide');
  const amount = Math.round(+req.body?.amount);
  if (!(amount > 0)) return fail(res, 'Montant invalide');
  // Verrou sur la commande : deux encaissements simultanés ne peuvent pas
  // dépasser le solde.
  const db = await pool.connect();
  let o, actual;
  try {
    await db.query('BEGIN');
    o = (await db.query('SELECT id, code, status, total FROM orders WHERE id=$1 FOR UPDATE', [+req.params.id])).rows[0];
    if (!o) { await db.query('ROLLBACK'); return fail(res, 'Commande introuvable', 404); }
    if (o.status === 'annule') { await db.query('ROLLBACK'); return fail(res, 'Commande annulée'); }
    const paid = (await db.query('SELECT COALESCE(SUM(amount),0)::int t FROM payments WHERE order_id=$1', [o.id])).rows[0].t;
    const balance = o.total - paid;
    if (balance <= 0) { await db.query('ROLLBACK'); return fail(res, 'Commande déjà intégralement réglée'); }
    actual = Math.min(amount, balance);
    await db.query('INSERT INTO payments(order_id,amount,method,created_at,created_by) VALUES($1,$2,$3,$4,$5)',
      [o.id, actual, method, new Date().toISOString(), req.user.username]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  finally { db.release(); }
  logActivity(req.user, 'payment', 'order', o.id, `${o.code} — ${actual} FCFA (${method})`);
  res.json(await orderWithPayments(o.id));
});

/* GET /:id/payments — list payments for an order */
router.get('/:id/payments', auth('payments.view'), async (req, res) => {
  const payments = await qAll('SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [+req.params.id]);
  res.json(payments);
});

module.exports = router;
