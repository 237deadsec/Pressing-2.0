'use strict';

const { Pool } = require('pg');

// ── Connection ──────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL requise'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') || DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});

const q   = (text, params) => pool.query(text, params);
const q1  = async (text, params) => (await q(text, params)).rows[0] || null;
const qAll = async (text, params) => (await q(text, params)).rows;

// ── Schema bootstrap ───────────────────────────────────────────
// hashPwd is injected to avoid circular dep with auth.js
async function initDB(hashPwd) {
  await q(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'caissier',
    active BOOLEAN DEFAULT true, must_change BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await q(`CREATE TABLE IF NOT EXISTS catalog(
    id SERIAL PRIMARY KEY, name TEXT NOT NULL,
    price NUMERIC NOT NULL, category TEXT DEFAULT 'article',
    active BOOLEAN DEFAULT true)`);

  await q(`CREATE TABLE IF NOT EXISTS clients(
    id SERIAL PRIMARY KEY, name TEXT NOT NULL,
    phone TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())`);

  await q(`CREATE TABLE IF NOT EXISTS orders(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    client_name TEXT, client_phone TEXT,
    items JSONB, weight NUMERIC,
    type TEXT DEFAULT 'article',
    total NUMERIC NOT NULL, discount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'depose',
    payment_mode TEXT DEFAULT 'Espèces',
    payment_method TEXT DEFAULT 'Espèces',
    notes TEXT, created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    due_date DATE, delivered_at TIMESTAMPTZ,
    invoice_no TEXT, track_token TEXT)`);

  await q(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`);

  await q(`CREATE TABLE IF NOT EXISTS payments(
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    amount NUMERIC NOT NULL,
    method TEXT DEFAULT 'Espèces',
    received_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await q(`CREATE TABLE IF NOT EXISTS status_history(
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    old_status TEXT, new_status TEXT,
    changed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await q(`CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY, value TEXT)`);

  // ── Migrations ──────────────────────────────────────────────
  const cols = await qAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name='orders'`
  );
  const has = (n) => cols.some((c) => c.column_name === n);
  if (!has('track_token'))
    await q('ALTER TABLE orders ADD COLUMN track_token TEXT');

  const catCols = await qAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name='catalog'`
  );
  if (!catCols.some((c) => c.column_name === 'price_express'))
    await q('ALTER TABLE catalog ADD COLUMN price_express NUMERIC');
  if (!catCols.some((c) => c.column_name === 'category'))
    await q("ALTER TABLE catalog ADD COLUMN category TEXT DEFAULT 'article'");

  const cliCols = await qAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name='clients'`
  );
  const cliHas = (n) => cliCols.some((c) => c.column_name === n);
  if (!cliHas('email'))   await q('ALTER TABLE clients ADD COLUMN email TEXT');
  if (!cliHas('address')) await q('ALTER TABLE clients ADD COLUMN address TEXT');
  if (!cliHas('notes'))   await q('ALTER TABLE clients ADD COLUMN notes TEXT');

  // price_history
  await q(`CREATE TABLE IF NOT EXISTS price_history(
    id SERIAL PRIMARY KEY,
    catalog_id INTEGER REFERENCES catalog(id),
    old_price NUMERIC, new_price NUMERIC,
    changed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  // subscriptions
  await q(`CREATE TABLE IF NOT EXISTS subscriptions(
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id),
    plan TEXT NOT NULL,
    total_articles INTEGER NOT NULL,
    used_articles INTEGER DEFAULT 0,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'actif',
    start_date DATE, end_date DATE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  // activity_log
  await q(`CREATE TABLE IF NOT EXISTS activity_log(
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    entity TEXT, entity_id INTEGER,
    detail TEXT, user_name TEXT, user_role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  // ── Seed defaults ───────────────────────────────────────────
  const userCount = await q1('SELECT count(*)::int AS n FROM users');
  if (userCount.n === 0) {
    const h = await hashPwd('admin');
    await q(
      `INSERT INTO users(username,password,name,role,must_change)
       VALUES('admin',$1,'Administrateur','gerant',true)`,
      [h]
    );
  }

  const catCount = await q1('SELECT count(*)::int AS n FROM catalog');
  if (catCount.n === 0) {
    const items = [
      ['Chemise', 500], ['Pantalon', 500], ['Robe', 800],
      ['Costume 2 pièces', 1500], ['Costume 3 pièces', 2000],
      ['Veste', 1000], ['Jupe', 500], ['T-shirt', 300],
      ['Drap', 1000], ['Couverture', 1500],
    ];
    for (const [n, p] of items) {
      await q('INSERT INTO catalog(name,price) VALUES($1,$2)', [n, p]);
    }
  }

  const defaults = [
    ['shop_name', 'Light Pressing'],
    ['kilo_price', '700'],
    ['default_delay', '2'],
    ['order_seq', '0'],
    ['invoice_seq', '0'],
    ['invoice_format', 'A6'],
    ['invoice_footer', 'Merci de votre confiance !'],
  ];
  for (const [k, v] of defaults) {
    await q(
      `INSERT INTO settings(key,value) VALUES($1,$2)
       ON CONFLICT(key) DO NOTHING`,
      [k, v]
    );
  }

  console.log('DB tables OK');
}

module.exports = { pool, q, q1, qAll, initDB };
