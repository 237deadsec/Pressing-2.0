const { Router } = require('express');
const { q1, qAll } = require('../db');
const { fail, DATE_RE, localDate } = require('../config');
const { auth } = require('../middleware');

const router = Router();

/* GET /api/stats — dashboard */
router.get('/stats', auth('stats.view'), async (req, res) => {
  const t = localDate();
  const today = await q1("SELECT COALESCE(SUM(total),0)::int ca, COUNT(*)::int n FROM orders WHERE day=$1 AND status!='annule'", [t]);
  const pending = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status IN ('depose','traitement')")).n;
  const ready = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status='pret'")).n;
  const late = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status IN ('depose','traitement','pret') AND promise_date IS NOT NULL AND promise_date<$1", [t])).n;
  const dueR = await q1(`SELECT COALESCE(SUM(o.total - COALESCE(p.t,0)),0)::int v, COUNT(*)::int n
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) p ON p.order_id=o.id
    WHERE o.status!='annule' AND o.total > COALESCE(p.t,0)`);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const r = await q1("SELECT COALESCE(SUM(total),0)::int ca FROM orders WHERE day=$1 AND status!='annule'", [localDate(d)]);
    days.push({ label: d.toLocaleDateString('fr-FR', { weekday: 'short' }), ca: r.ca });
  }
  const byStatus = await qAll('SELECT status, COUNT(*)::int n FROM orders GROUP BY status');
  res.json({ today, pending, ready, late, due: dueR, days, byStatus });
});

/* GET /api/late-orders */
router.get('/late-orders', auth('stats.view'), async (req, res) => {
  const t = localDate();
  const rows = await qAll(`
    SELECT o.id, o.code, o.client_name, o.phone, o.status, o.promise_date, o.day,
      (CURRENT_DATE - o.promise_date::date) AS days_late
    FROM orders o
    WHERE o.status IN ('depose','traitement','pret')
      AND o.promise_date IS NOT NULL AND o.promise_date < $1
    ORDER BY o.promise_date ASC LIMIT 50`, [t]);
  res.json(rows);
});

/* GET /api/reports */
router.get('/reports', auth('reports.view'), async (req, res) => {
  const d30 = new Date(); d30.setDate(d30.getDate() - 29);
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : localDate(d30);
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : localDate();
  const rows = await qAll("SELECT * FROM orders WHERE day BETWEEN $1 AND $2 AND status!='annule'", [from, to]);
  for (const o of rows) { if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items); o.weight = o.weight ? Number(o.weight) : null; }
  const ca = rows.reduce((s, o) => s + o.total, 0);
  const byDay = {}, byPay = {}, top = {};
  let kg = 0, caKilo = 0, discounts = 0;
  for (const o of rows) {
    byDay[o.day] = (byDay[o.day] || 0) + o.total;
    byPay[o.payment_mode] = (byPay[o.payment_mode] || 0) + o.total;
    discounts += o.discount;
    if (o.type === 'kilo') { kg += o.weight || 0; caKilo += o.total; }
    else if (o.items) o.items.forEach(i => {
      const x = top[i.name] || (top[i.name] = { name: i.name, qty: 0, ca: 0 });
      x.qty += i.qty; x.ca += i.price * i.qty;
    });
  }
  const credits = await qAll(`SELECT o.*, COALESCE(p.t,0)::int paid_total
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) p ON p.order_id=o.id
    WHERE o.status!='annule' AND o.total > COALESCE(p.t,0) ORDER BY o.id`);
  for (const c of credits) { c.balance = c.total - c.paid_total; if (c.items && typeof c.items === 'string') c.items = JSON.parse(c.items); }
  const cancelled = await q1("SELECT COUNT(*)::int n, COALESCE(SUM(total),0)::int v FROM orders WHERE day BETWEEN $1 AND $2 AND status='annule'", [from, to]);
  const encaissements = await q1(`SELECT COALESCE(SUM(p.amount),0)::int total FROM payments p
    JOIN orders o ON o.id=p.order_id WHERE o.day BETWEEN $1 AND $2 AND o.status!='annule'`, [from, to]);
  res.json({
    from, to, ca, n: rows.length, avg: rows.length ? Math.round(ca / rows.length) : 0,
    kg: Math.round(kg * 100) / 100, caKilo, discounts, encaissements: encaissements.total,
    byDay: Object.entries(byDay).sort().map(([day, v]) => ({ day, v })),
    byPay, top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 10), credits, cancelled
  });
});

module.exports = router;
