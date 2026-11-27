const { Router } = require('../router');
const { q1, qAll } = require('../db');
const { fail } = require('../config');
const { logActivity } = require('../helpers');
const { auth } = require('../middleware');

const router = Router();

/* GET / — list all clients with aggregated stats */
router.get('/', auth(), async (req, res) => {
  res.json(await qAll(`SELECT c.id, c.name, c.phone, COUNT(o.id)::int n, COALESCE(SUM(o.total),0)::int ca,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total - COALESCE(pay.t,0) ELSE 0 END),0)::int due
    FROM clients c LEFT JOIN orders o ON o.client_id=c.id AND o.status!='annule'
    LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    GROUP BY c.id ORDER BY ca DESC`));
});

/* POST / — create client */
router.post('/', auth('clients.create'), async (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  if (!name || !name.trim()) return fail(res, 'Nom requis');
  const exists = await q1('SELECT id FROM clients WHERE lower(name)=lower($1) AND phone=$2', [name.trim(), (phone||'').trim()]);
  if (exists) return fail(res, 'Ce client existe déjà');
  const c = await q1(
    'INSERT INTO clients(name,phone,email,address,notes) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,email,address,notes',
    [name.trim(), (phone||'').trim(), (email||'').trim(), (address||'').trim(), (notes||'').trim()]
  );
  logActivity(req.user, 'create_client', 'client', c.id, c.name);
  res.json(c);
});

/* GET /search — autocomplete */
router.get('/search', auth(), async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json([]);
  res.json(await qAll('SELECT id,name,phone FROM clients WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY name LIMIT 10', [`%${search}%`]));
});

/* GET /:id — client detail with stats + recent orders */
router.get('/:id', auth(), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, 'ID invalide');
  const client = await q1(`SELECT c.id, c.name, c.phone, COALESCE(c.email,'') email, COALESCE(c.address,'') address, COALESCE(c.notes,'') notes,
    COUNT(o.id)::int total_orders,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total ELSE 0 END),0)::int ca,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total - COALESCE(pay.t,0) ELSE 0 END),0)::int due
    FROM clients c LEFT JOIN orders o ON o.client_id=c.id
    LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    WHERE c.id=$1 GROUP BY c.id`, [id]);
  if (!client) return fail(res, 'Client introuvable', 404);
  const orders = await qAll(`SELECT o.id, o.code, o.type, o.total, o.status, o.day, o.promise_date,
    COALESCE(pay.t,0)::int paid, (o.total - COALESCE(pay.t,0))::int balance
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    WHERE o.client_id=$1 ORDER BY o.id DESC LIMIT 50`, [id]);
  res.json({ ...client, orders });
});

/* GET /:id/subscriptions — client subscriptions */
router.get('/:id/subscriptions', auth(), async (req, res) => {
  const rows = await qAll('SELECT * FROM subscriptions WHERE client_id=$1 ORDER BY id DESC', [+req.params.id]);
  res.json(rows);
});

/* PUT /:id — update client */
router.put('/:id', auth('clients.edit'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, 'ID invalide');
  const { name, phone, email, address, notes } = req.body;
  if (!name || !name.trim()) return fail(res, 'Nom requis');
  const updated = await q1(
    `UPDATE clients SET name=$1, phone=$2, email=$3, address=$4, notes=$5 WHERE id=$6 RETURNING id,name,phone,email,address,notes`,
    [name.trim(), (phone||'').trim(), (email||'').trim(), (address||'').trim(), (notes||'').trim(), id]
  );
  if (!updated) return fail(res, 'Client introuvable', 404);
  logActivity(req.user, 'update_client', 'client', id, updated.name);
  res.json(updated);
});

module.exports = router;
