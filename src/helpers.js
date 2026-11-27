'use strict';

const { pool, q, q1, qAll } = require('./db');
const { applyCustomPermissions, resetPermissions } = require('./config');

// ── Settings helpers ────────────────────────────────────────────
const getS = async (k) =>
  (await q1('SELECT value FROM settings WHERE key=$1', [k]))?.value;

const setS = (k, v) =>
  q(
    `INSERT INTO settings(key,value) VALUES($1,$2)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [k, String(v)]
  );

// ── Activity log ────────────────────────────────────────────────
async function logActivity(user, action, entity, entityId, detail) {
  try {
    await q(
      `INSERT INTO activity_log(action,entity,entity_id,detail,user_name,user_role,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        action,
        entity || null,
        entityId || null,
        String(detail || '').slice(0, 500),
        user.name,
        user.role,
        new Date().toISOString(),
      ]
    );
  } catch (e) {
    console.error('logActivity err:', e.message);
  }
}

// ── Public settings bundle ──────────────────────────────────────
async function publicSettings() {
  return {
    shop_name:            await getS('shop_name'),
    shop_address:         await getS('shop_address'),
    shop_phone:           await getS('shop_phone'),
    shop_niu:             await getS('shop_niu'),
    kilo_price:         +(await getS('kilo_price')),
    default_delay:      +(await getS('default_delay')),
    max_discount_percent: +(await getS('max_discount_percent') || '100'),
    invoice_format:       await getS('invoice_format') || 'A6',
    invoice_logo:         await getS('invoice_logo') || '',
    invoice_header:       await getS('invoice_header') || '',
    invoice_footer:       await getS('invoice_footer') || 'Merci de votre confiance !',
  };
}

// ── Sanitise user for client ────────────────────────────────────
const pub = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  must_change: !!u.must_change,
});

// ── Full order with payments + history ──────────────────────────
async function orderWithPayments(id) {
  const o = await q1('SELECT * FROM orders WHERE id=$1', [id]);
  if (!o) return null;
  if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
  o.weight = o.weight ? Number(o.weight) : null;
  const payments = await qAll(
    'SELECT * FROM payments WHERE order_id=$1 ORDER BY id',
    [id]
  );
  o.paid_total = payments.reduce((s, p) => s + p.amount, 0);
  o.balance = o.total - o.paid_total;
  o.payments = payments;
  const history = await qAll(
    'SELECT * FROM status_history WHERE order_id=$1 ORDER BY id',
    [id]
  );
  o.status_history = history;
  return o;
}

// ── Sequence generators ─────────────────────────────────────────
// `db` : client de la transaction en cours, pour qu'une annulation (ROLLBACK)
// rende aussi le numéro. Sans lui, la commande échouée laissait un trou.
async function nextOrderCode(day, db = pool) {
  const r = (await db.query(
    "UPDATE settings SET value = (CAST(value AS INTEGER)+1)::TEXT WHERE key='order_seq' RETURNING value"
  )).rows[0];
  const n = parseInt(r.value);
  return 'LP-' + day.slice(2).replace(/-/g, '') + '-' + String(n).padStart(4, '0');
}

async function nextInvoiceNo(db = pool) {
  const r = (await db.query(
    "UPDATE settings SET value = (CAST(value AS INTEGER)+1)::TEXT WHERE key='invoice_seq' RETURNING value"
  )).rows[0];
  return 'FAC-' + String(parseInt(r.value)).padStart(5, '0');
}

// ── Permissions personnalisées (table settings) ─────────────────
// Sur Vercel, plusieurs instances tournent en parallèle et chacune a sa
// propre mémoire. On relit donc la ligne `permissions` en base dès que la
// copie locale a plus de PERMISSIONS_TTL_MS : une modification faite sur une
// instance est visible partout en moins de PERMISSIONS_TTL_MS.
const PERMISSIONS_TTL_MS = Number(process.env.PERMISSIONS_TTL_MS ?? 10000);
let permsLoadedAt = 0;
let permsLoading = null;

async function loadPermissions() {
  const row = await q1("SELECT value FROM settings WHERE key='permissions'");
  resetPermissions();
  if (row?.value) applyCustomPermissions(JSON.parse(row.value));
  permsLoadedAt = Date.now();
}

// Recharge si la copie locale est trop ancienne. Les appels simultanés
// partagent la même requête.
async function ensureFreshPermissions() {
  if (Date.now() - permsLoadedAt < PERMISSIONS_TTL_MS) return;
  if (!permsLoading) permsLoading = loadPermissions().finally(() => { permsLoading = null; });
  await permsLoading;
}

module.exports = {
  getS,
  setS,
  logActivity,
  publicSettings,
  pub,
  orderWithPayments,
  nextOrderCode,
  nextInvoiceNo,
  loadPermissions,
  ensureFreshPermissions,
};
