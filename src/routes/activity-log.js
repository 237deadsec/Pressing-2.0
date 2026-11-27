const { Router } = require('../router');
const { q1, qAll } = require('../db');
const { DATE_RE } = require('../config');
const { auth } = require('../middleware');

const router = Router();

/* GET /api/activity-log — paginated activity journal */
router.get('/', auth('activity.view'), async (req, res) => {
  const page = Math.max(1, +(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, +(req.query.limit || 50)));
  const offset = (page - 1) * limit;
  let where = [], params = [];
  let pi = 1;
  if (req.query.action) { where.push(`action=$${pi++}`); params.push(req.query.action); }
  if (req.query.entity) { where.push(`entity=$${pi++}`); params.push(req.query.entity); }
  if (req.query.user_name) { where.push(`user_name ILIKE $${pi++}`); params.push(`%${req.query.user_name}%`); }
  if (DATE_RE.test(req.query.from || '')) { where.push(`created_at >= $${pi++}`); params.push(req.query.from + 'T00:00:00'); }
  if (DATE_RE.test(req.query.to || '')) { where.push(`created_at <= $${pi++}`); params.push(req.query.to + 'T23:59:59'); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await q1(`SELECT COUNT(*)::int c FROM activity_log ${wc}`, params)).c;
  const rows = await qAll(`SELECT * FROM activity_log ${wc} ORDER BY created_at DESC LIMIT $${pi++} OFFSET $${pi++}`, [...params, limit, offset]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
});

module.exports = router;
