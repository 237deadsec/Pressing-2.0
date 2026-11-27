const { Router } = require('../router');
const { q1, qAll } = require('../db');
const { localDate } = require('../config');
const { logActivity } = require('../helpers');
const { auth } = require('../middleware');

const router = Router();

/* GET / — list all subscriptions */
router.get('/', auth('subscriptions.view'), async (req, res) => {
  const rows = await qAll(`SELECT s.*, c.name AS client_name, c.phone AS client_phone
    FROM subscriptions s JOIN clients c ON c.id=s.client_id ORDER BY s.id DESC`);
  res.json(rows);
});

/* POST / — create subscription */
router.post('/', auth('subscriptions.manage'), async (req, res) => {
  const { client_id, plan_name, total_articles, amount_paid, end_date, notes } = req.body;
  if (!client_id || !plan_name || !total_articles || total_articles < 1) return res.status(400).json({ error: 'Champs requis manquants' });
  const client = await q1('SELECT id FROM clients WHERE id=$1', [+client_id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  const now = new Date().toISOString();
  const start = localDate();
  const end = end_date || new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);
  const row = await q1(`INSERT INTO subscriptions(client_id, plan_name, total_articles, amount_paid, start_date, end_date, created_at, created_by, notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [+client_id, String(plan_name).trim().slice(0,100), +total_articles, +(amount_paid||0), start, end, now, req.user.name, String(notes||'').slice(0,500)]);
  logActivity(req.user, 'create_subscription', 'subscription', row.id, `${plan_name} — ${total_articles} articles`);
  res.status(201).json(row);
});

/* PUT /:id — update subscription */
router.put('/:id', auth('subscriptions.manage'), async (req, res) => {
  const sub = await q1('SELECT * FROM subscriptions WHERE id=$1', [+req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  const { plan_name, total_articles, amount_paid, end_date, status, notes } = req.body;
  const validStatuses = ['actif', 'expiré', 'épuisé', 'annulé'];
  const newStatus = validStatuses.includes(status) ? status : sub.status;
  const row = await q1(`UPDATE subscriptions SET plan_name=$1, total_articles=$2, amount_paid=$3, end_date=$4, status=$5, notes=$6 WHERE id=$7 RETURNING *`,
    [String(plan_name||sub.plan_name).trim().slice(0,100), +(total_articles||sub.total_articles), +(amount_paid||sub.amount_paid), end_date||sub.end_date, newStatus, String(notes??sub.notes).slice(0,500), +req.params.id]);
  logActivity(req.user, 'update_subscription', 'subscription', +req.params.id, `Status: ${newStatus}`);
  res.json(row);
});

/* POST /:id/use — use subscription credits */
router.post('/:id/use', auth('subscriptions.use'), async (req, res) => {
  const sub = await q1('SELECT * FROM subscriptions WHERE id=$1', [+req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  if (sub.status !== 'actif') return res.status(400).json({ error: 'Abonnement non actif' });
  const qty = Math.max(1, +(req.body.quantity || 1));
  if (sub.used_articles + qty > sub.total_articles) return res.status(400).json({ error: 'Crédit insuffisant' });
  const newUsed = sub.used_articles + qty;
  const newStatus = newUsed >= sub.total_articles ? 'épuisé' : 'actif';
  const row = await q1('UPDATE subscriptions SET used_articles=$1, status=$2 WHERE id=$3 RETURNING *', [newUsed, newStatus, +req.params.id]);
  logActivity(req.user, 'use_subscription', 'subscription', +req.params.id, `${qty} article(s) utilisé(s) — ${newUsed}/${sub.total_articles}`);
  res.json(row);
});

module.exports = router;
