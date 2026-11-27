const { Router } = require('../router');
const { qAll } = require('../db');
const { auth } = require('../middleware');

const router = Router();

/* GET / — clients with unpaid balances */
router.get('/', auth('creances.view'), async (req, res) => {
  const rows = await qAll(`
    SELECT c.id, c.name, c.phone,
      COUNT(o.id)::int unpaid_orders,
      COALESCE(SUM(o.total),0)::int total,
      COALESCE(SUM(COALESCE(pay.t,0)),0)::int paid,
      COALESCE(SUM(o.total - COALESCE(pay.t,0)),0)::int due
    FROM clients c
    JOIN orders o ON o.client_id=c.id AND o.status!='annule'
    LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    WHERE o.total > COALESCE(pay.t,0)
    GROUP BY c.id ORDER BY due DESC`);
  const total_due = rows.reduce((s,r) => s + r.due, 0);
  res.json({ clients: rows, total_due, count: rows.length });
});

module.exports = router;
