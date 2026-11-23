const { Router } = require('express');
const { q } = require('../db');

const router = Router();

/* GET /api/health — public DB connectivity check */
router.get('/', async (req, res) => {
  try { await q('SELECT 1'); res.json({ status: 'ok', time: new Date().toISOString() }); }
  catch { res.status(503).json({ status: 'db_error' }); }
});

module.exports = router;
