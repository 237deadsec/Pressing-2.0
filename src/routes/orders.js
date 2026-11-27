const { Router } = require('../router');
const crypto = require('crypto');
const { pool, q, q1, qAll } = require('../db');
const { fail, hasPermission, STATUSES, PAYMENT_MODES, PAYMENT_METHODS, DATE_RE, TRANSITIONS, CANCELLABLE } = require('../config');
const { getS, logActivity, orderWithPayments, nextOrderCode, nextInvoiceNo } = require('../helpers');
const { auth } = require('../middleware');
const { localDate } = require('../config');

const router = Router();

// POST /api/orders — create
router.post('/', auth('orders.create'), async (req, res) => {
  const b = req.body || {}, u = req.user;
  const name = String(b.client || '').trim().slice(0, 100);
  const phone = String(b.phone || '').trim().slice(0, 40);
  if (!name) return fail(res, 'Nom du client requis');
  if (!PAYMENT_MODES.includes(b.payment)) return fail(res, 'Mode de paiement invalide');
  const type = b.type === 'kilo' ? 'kilo' : 'article';
  let items = null, weight = null, price_kg = null, kilo_items = null, subtotal = 0;

  if (type === 'article') {
    if (!Array.isArray(b.items) || !b.items.length) return fail(res, 'Le panier est vide');
    const isExpress = !!b.express;
    items = [];
    for (const it of b.items) {
      const c = await q1('SELECT * FROM catalog WHERE id=$1 AND active=true', [+it.id]);
      const qty = Math.floor(+it.qty);
      if (!c || !(qty > 0) || qty > 1000) return fail(res, 'Article invalide');
      const unitPrice = isExpress && c.price_express > 0 ? c.price_express : c.price;
      items.push({ id: c.id, name: c.name, icon: c.icon, price: unitPrice, qty, express: isExpress });
      subtotal += unitPrice * qty;
    }
  } else {
    weight = Math.round(+b.weight * 100) / 100;
    if (!(weight > 0) || weight > 1000) return fail(res, 'Poids invalide');
    const def = +(await getS('kilo_price'));
    price_kg = u.role === 'caissier' ? def : Math.round(+b.price_kg || def);
    if (!(price_kg > 0)) return fail(res, 'Tarif au kilo invalide');
    subtotal = Math.round(weight * price_kg);
    kilo_items = String(b.kilo_items || '').slice(0, 2000);
  }
  let discount = 0, discount_reason = null;
  if (u.role !== 'caissier' && +b.discount > 0) {
    const maxPct = +(await getS('max_discount_percent') || '100');
    const maxDisc = Math.round(subtotal * maxPct / 100);
    discount = Math.max(0, Math.min(maxDisc, Math.round(+b.discount)));
    if (discount > 0) {
      discount_reason = String(b.discount_reason || '').trim().slice(0, 200);
      if (!discount_reason) return fail(res, 'Motif de la remise obligatoire');
    }
  }
  const total = subtotal - discount;
  const promise = DATE_RE.test(b.promise_date || '') ? b.promise_date : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let cr = await client.query('SELECT id FROM clients WHERE lower(name)=lower($1) AND phone=$2', [name, phone]);
    const cid = cr.rows[0]
      ? cr.rows[0].id
      : (await client.query('INSERT INTO clients(name,phone) VALUES($1,$2) RETURNING id', [name, phone])).rows[0].id;

    const day = localDate();
    const code = await nextOrderCode(day, client);
    const now = new Date().toISOString();
    const trackToken = crypto.randomBytes(12).toString('base64url');

    const or = await client.query(`INSERT INTO orders(code,type,client_id,client_name,phone,items,weight,price_kg,kilo_items,
      subtotal,discount,discount_reason,total,status,payment_mode,promise_date,day,created_at,created_by,track_token)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'depose',$14,$15,$16,$17,$18,$19) RETURNING id`,
      [code, type, cid, name, phone, items ? JSON.stringify(items) : null, weight, price_kg, kilo_items,
       subtotal, discount, discount_reason, total, b.payment, promise, day, now, u.username, trackToken]);
    const orderId = or.rows[0].id;

    await client.query('INSERT INTO status_history(order_id,old_status,new_status,changed_at,changed_by) VALUES($1,NULL,$2,$3,$4)',
      [orderId, 'depose', now, u.username]);

    if (b.payment !== 'Crédit') {
      await client.query('INSERT INTO payments(order_id,amount,method,created_at,created_by) VALUES($1,$2,$3,$4,$5)',
        [orderId, total, b.payment, now, u.username]);
    } else {
      const acompte = Math.max(0, Math.min(total, Math.round(+b.acompte || 0)));
      if (acompte > 0) {
        const aMethod = PAYMENT_METHODS.includes(b.acompte_method) ? b.acompte_method : 'Espèces';
        await client.query('INSERT INTO payments(order_id,amount,method,created_at,created_by) VALUES($1,$2,$3,$4,$5)',
          [orderId, acompte, aMethod, now, u.username]);
      }
    }

    await client.query('COMMIT');
    logActivity(u, 'create_order', 'order', orderId, `${code} — ${name} — ${total} FCFA`);
    res.json(await orderWithPayments(orderId));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erreur création commande:', e.message);
    fail(res, 'Erreur lors de la création', 500);
  } finally { client.release(); }
});

// GET /api/orders — list
router.get('/', auth('orders.view'), async (req, res) => {
  const { status, q: search, from, to, page = '1' } = req.query;
  const w = [], a = [];
  let n = 0;
  if (status && status !== 'all' && STATUSES.includes(status)) { w.push(`status=$${++n}`); a.push(status); }
  if (search) { w.push(`(code ILIKE $${++n} OR client_name ILIKE $${n} OR phone ILIKE $${n})`); a.push(`%${search}%`); }
  if (DATE_RE.test(from || '')) { w.push(`day >= $${++n}`); a.push(from); }
  if (DATE_RE.test(to || '')) { w.push(`day <= $${++n}`); a.push(to); }
  const limit = 50, offset = (Math.max(1, +page) - 1) * limit;
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = await q1(`SELECT COUNT(*)::int c FROM orders ${where}`, a);
  const rows = await qAll(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, a);
  for (const o of rows) {
    if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
    o.weight = o.weight ? Number(o.weight) : null;
    const p = await q1('SELECT COALESCE(SUM(amount),0)::int t FROM payments WHERE order_id=$1', [o.id]);
    o.paid_total = p.t;
    o.balance = o.total - p.t;
  }
  res.json({ orders: rows, total: total.c, page: +page, pages: Math.ceil(total.c / limit) });
});

// GET /api/orders/:id — single order
router.get('/:id', auth('orders.view'), async (req, res) => {
  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  res.json(o);
});

// PUT /api/orders/:id — edit order
router.put('/:id', auth('orders.edit'), async (req, res) => {
  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  if (o.status !== 'depose') return fail(res, 'Seules les commandes au statut "déposé" peuvent être modifiées');

  const b = req.body || {};
  const u = req.user;
  const type = o.type; // cannot change type

  let items = null, weight = null, price_kg = null, kilo_items = null, subtotal = 0;

  if (type === 'article') {
    if (!Array.isArray(b.items) || !b.items.length) return fail(res, 'Le panier est vide');
    const isExpress = !!b.express;
    items = [];
    for (const it of b.items) {
      const c = await q1('SELECT * FROM catalog WHERE id=$1 AND active=true', [+it.id]);
      const qty = Math.floor(+it.qty);
      if (!c || !(qty > 0) || qty > 1000) return fail(res, 'Article invalide');
      const unitPrice = isExpress && c.price_express > 0 ? c.price_express : c.price;
      items.push({ id: c.id, name: c.name, icon: c.icon, price: unitPrice, qty, express: isExpress });
      subtotal += unitPrice * qty;
    }
  } else {
    weight = Math.round(+b.weight * 100) / 100;
    if (!(weight > 0) || weight > 1000) return fail(res, 'Poids invalide');
    const def = +(await getS('kilo_price'));
    price_kg = Math.round(+b.price_kg || def);
    if (!(price_kg > 0)) return fail(res, 'Tarif au kilo invalide');
    subtotal = Math.round(weight * price_kg);
    kilo_items = String(b.kilo_items || '').slice(0, 2000);
  }

  let discount = 0, discount_reason = null;
  if (+b.discount > 0) {
    const maxPct = +(await getS('max_discount_percent') || '100');
    const maxDisc = Math.round(subtotal * maxPct / 100);
    discount = Math.max(0, Math.min(maxDisc, Math.round(+b.discount)));
    if (discount > 0) {
      discount_reason = String(b.discount_reason || '').trim().slice(0, 200);
      if (!discount_reason) return fail(res, 'Motif de la remise obligatoire');
    }
  }
  const total = subtotal - discount;
  const promise = DATE_RE.test(b.promise_date || '') ? b.promise_date : o.promise_date;

  if (total < o.paid_total) return fail(res, `Le nouveau total (${total}) est inférieur aux paiements déjà effectués (${o.paid_total})`);

  try {
    await q(`UPDATE orders SET items=$1,weight=$2,price_kg=$3,kilo_items=$4,subtotal=$5,
      discount=$6,discount_reason=$7,total=$8,promise_date=$9 WHERE id=$10`,
      [items ? JSON.stringify(items) : null, weight, price_kg, kilo_items, subtotal,
       discount, discount_reason, total, promise, o.id]);
    logActivity(u, 'edit_order', 'order', o.id, `${o.code} — total: ${total} FCFA`);
    res.json(await orderWithPayments(o.id));
  } catch (e) {
    console.error('Erreur édition commande:', e.message);
    fail(res, 'Erreur lors de la modification', 500);
  }
});

// PUT /api/orders/:id/status — change status
router.put('/:id/status', auth('orders.status', 'orders.cancel'), async (req, res) => {
  const st = req.body?.status;
  if (!STATUSES.includes(st)) return fail(res, 'Statut invalide');

  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  const role = req.user.role;

  if (st === 'annule') {
    if (!CANCELLABLE.includes(o.status)) return fail(res, 'Impossible d\'annuler une commande ' + o.status);
    if (!hasPermission(role, 'orders.cancel')) return fail(res, 'Annulation non autorisée pour votre rôle', 403);
    if (o.invoice_no && role !== 'gerant') return fail(res, 'Commande facturée : annulation réservée au gérant', 403);
  } else {
    if (!hasPermission(role, 'orders.status')) return fail(res, 'Changement de statut non autorisé pour votre rôle', 403);
    const allowed = TRANSITIONS[o.status] || [];
    if (!allowed.includes(st)) return fail(res, `Transition ${o.status} → ${st} non autorisée. Transitions possibles : ${allowed.join(', ') || 'aucune'}`);
    if (st === 'livre') {
      if (o.balance > 0 && role === 'caissier')
        return fail(res, `Solde impayé : ${o.balance} F. Encaissez avant de livrer.`);
    }
  }

  const now = new Date().toISOString();
  const note = String(req.body?.note || '').trim().slice(0, 300) || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let invoice_no = o.invoice_no, delivered_at = o.delivered_at;
    if (st === 'livre') {
      delivered_at = delivered_at || now;
      if (!invoice_no) invoice_no = await nextInvoiceNo(client);
    }
    await client.query('UPDATE orders SET status=$1,delivered_at=$2,invoice_no=$3 WHERE id=$4', [st, delivered_at, invoice_no, o.id]);
    await client.query('INSERT INTO status_history(order_id,old_status,new_status,changed_at,changed_by,note) VALUES($1,$2,$3,$4,$5,$6)',
      [o.id, o.status, st, now, req.user.username, note]);
    await client.query('COMMIT');
    logActivity(req.user, 'status_change', 'order', o.id, `${o.code} : ${o.status} → ${st}`);
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  res.json(await orderWithPayments(o.id));
});

module.exports = router;
