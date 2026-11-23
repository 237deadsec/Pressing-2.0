const { Router } = require('express');
const { qAll } = require('../db');
const { fail, localDate } = require('../config');
const { auth } = require('../middleware');

const router = Router();

/* GET /api/backup — export all tables as JSON */
router.get('/', auth('backup.create'), async (req, res) => {
  try {
    const data = {
      exported_at: new Date().toISOString(),
      users: await qAll('SELECT id,username,name,role,active,must_change FROM users ORDER BY id'),
      catalog: await qAll('SELECT * FROM catalog ORDER BY id'),
      clients: await qAll('SELECT * FROM clients ORDER BY id'),
      orders: await qAll('SELECT * FROM orders ORDER BY id'),
      payments: await qAll('SELECT * FROM payments ORDER BY id'),
      status_history: await qAll('SELECT * FROM status_history ORDER BY id'),
      settings: await qAll('SELECT * FROM settings ORDER BY key')
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="light-pressing-${localDate()}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) { fail(res, 'Sauvegarde impossible', 500); }
});

module.exports = router;
