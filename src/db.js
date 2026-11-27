'use strict';

const { Pool } = require('pg');
const { hashPwd } = require('./auth');

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

// Sans ce gestionnaire, une connexion inactive coupée par le serveur
// (redémarrage Postgres/Supabase) émet un 'error' non écouté et tue Node.
pool.on('error', (e) => console.error('PG pool error:', e.message));

const q   = (text, params) => pool.query(text, params);
const q1  = async (text, params) => (await q(text, params)).rows[0] || null;
const qAll = async (text, params) => (await q(text, params)).rows;

// ── Schéma ──────────────────────────────────────────────────────
// Schéma de référence : celui de la base de production (créée par le code
// d'avant le refactor P3.6, commit 81d8261). Les routes s'appuient dessus
// (users.pwd, orders.phone/day/subtotal…, payments.created_by, etc.).
//
// initDB() est rejoué à chaque démarrage (et à chaque démarrage à froid sur
// Vercel). Règle : sur une base déjà à jour, il ne lance AUCUN DDL. Chaque
// création ou modification est précédée d'une lecture du catalogue Postgres.
// C'est indispensable en production : le rôle applicatif n'est pas
// propriétaire de toutes les tables, et Postgres refuse ALTER TABLE et
// CREATE INDEX à un non-propriétaire, même avec IF NOT EXISTS.

const tableExists = async (t) =>
  !!(await q1(`SELECT 1 FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_name = $1`, [t]));

const columnType = async (t, c) =>
  (await q1(`SELECT data_type FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, [t, c]))?.data_type || null;

const indexExists = async (name) =>
  !!(await q1(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1`, [name]));

async function createTable(name, ddl) {
  if (await tableExists(name)) return false;
  await q(ddl);
  return true;
}

async function addColumn(table, column, definition) {
  if (await columnType(table, column)) return;
  await q(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function createIndex(name, table, columns) {
  if (await indexExists(name)) return;
  await q(`CREATE INDEX ${name} ON ${table}(${columns})`);
}

async function initDB() {
  await createTable('users', `CREATE TABLE users(
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('caissier','superviseur','gerant')),
      pwd TEXT NOT NULL, must_change BOOLEAN DEFAULT true, active BOOLEAN DEFAULT true)`);

  await createTable('catalog', `CREATE TABLE catalog(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL,
      price_express INTEGER DEFAULT 0,
      icon TEXT DEFAULT '🧺', active BOOLEAN DEFAULT true)`);

  await createTable('clients', `CREATE TABLE clients(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '')`);

  await createTable('orders', `CREATE TABLE orders(
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('article','kilo')),
      client_id INTEGER REFERENCES clients(id), client_name TEXT NOT NULL, phone TEXT DEFAULT '',
      items JSONB, weight NUMERIC(10,2), price_kg INTEGER, kilo_items TEXT,
      subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, discount_reason TEXT,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'depose' CHECK(status IN ('depose','traitement','pret','livre','annule')),
      payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Espèces','Mobile Money','Crédit')),
      promise_date TEXT, day TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      delivered_at TEXT, invoice_no TEXT, track_token TEXT UNIQUE)`);

  await createTable('payments', `CREATE TABLE payments(
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      amount INTEGER NOT NULL CHECK(amount > 0),
      method TEXT NOT NULL CHECK(method IN ('Espèces','Mobile Money')),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL)`);

  await createTable('status_history', `CREATE TABLE status_history(
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      old_status TEXT, new_status TEXT NOT NULL,
      changed_at TEXT NOT NULL, changed_by TEXT NOT NULL, note TEXT)`);

  await createTable('settings', 'CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)');

  // ── Migrations (sans perte de données, sans DDL si déjà fait) ─
  await addColumn('orders', 'track_token', 'TEXT UNIQUE');
  await addColumn('catalog', 'price_express', 'INTEGER DEFAULT 0');
  await addColumn('catalog', 'icon', "TEXT DEFAULT '🧺'");
  // P1.2 — clients : email, adresse, notes
  await addColumn('clients', 'email', "TEXT DEFAULT ''");
  await addColumn('clients', 'address', "TEXT DEFAULT ''");
  await addColumn('clients', 'notes', "TEXT DEFAULT ''");
  // P2.1 — catégories du catalogue
  await addColumn('catalog', 'category', "TEXT DEFAULT 'Divers'");

  await createIndex('ix_orders_track', 'orders', 'track_token');
  await createIndex('ix_orders_day', 'orders', 'day');
  await createIndex('ix_orders_status', 'orders', 'status');
  await createIndex('ix_orders_client', 'orders', 'client_id');
  await createIndex('ix_payments_order', 'payments', 'order_id');
  await createIndex('ix_sh_order', 'status_history', 'order_id');

  // P2.2 — abonnements
  await createTable('subscriptions', `CREATE TABLE subscriptions(
    id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
    plan_name TEXT NOT NULL, total_articles INTEGER NOT NULL CHECK(total_articles > 0),
    used_articles INTEGER NOT NULL DEFAULT 0, amount_paid INTEGER NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'actif' CHECK(status IN ('actif','expiré','épuisé','annulé')),
    created_at TEXT NOT NULL, created_by TEXT NOT NULL, notes TEXT DEFAULT ''
  )`);
  await createIndex('ix_subs_client', 'subscriptions', 'client_id');

  // P2.4 — journal d'activités
  await createTable('activity_log', `CREATE TABLE activity_log(
    id SERIAL PRIMARY KEY, action TEXT NOT NULL, entity TEXT,
    entity_id INTEGER, detail TEXT DEFAULT '', user_name TEXT NOT NULL,
    user_role TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  if (!(await indexExists('ix_actlog_created')))
    await q('CREATE INDEX ix_actlog_created ON activity_log(created_at DESC)');

  // P3.1 — historique des prix. Selon l'historique de la base, la table
  // peut manquer, être complète (créée à la main dans Supabase), ou être la
  // version incomplète du commit P3.6 (ecb27c1 : sans *_price_express ni
  // changed_at, prix en NUMERIC, changed_by en TEXT). On ne touche qu'à ce
  // qui manque ou n'a pas le bon type.
  const phCreated = await createTable('price_history', `CREATE TABLE price_history(
    id SERIAL PRIMARY KEY, catalog_id INTEGER NOT NULL REFERENCES catalog(id),
    old_price INTEGER, new_price INTEGER,
    old_price_express INTEGER DEFAULT 0, new_price_express INTEGER DEFAULT 0,
    changed_by INTEGER REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  if (phCreated) {
    await q('CREATE INDEX ix_ph_catalog ON price_history(catalog_id, changed_at DESC)');
  } else {
    await addColumn('price_history', 'old_price_express', 'INTEGER DEFAULT 0');
    await addColumn('price_history', 'new_price_express', 'INTEGER DEFAULT 0');
    await addColumn('price_history', 'changed_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    // Aucune ligne n'a pu être écrite dans la version ecb27c1 (l'INSERT
    // échouait toujours), mais on convertit sans rien jeter au cas où.
    for (const col of ['old_price', 'new_price']) {
      const t = await columnType('price_history', col);
      if (t && t !== 'integer')
        await q(`ALTER TABLE price_history ALTER COLUMN ${col} TYPE INTEGER USING round(${col})::integer`);
    }
    const t = await columnType('price_history', 'changed_by');
    if (t && t !== 'integer')
      await q(`ALTER TABLE price_history ALTER COLUMN changed_by TYPE INTEGER
               USING NULLIF(regexp_replace(changed_by::text, '\\D', '', 'g'), '')::integer`);
  }

  // ── Données initiales (base vierge uniquement) ───────────────
  const hasUsers = await q1('SELECT 1 FROM users LIMIT 1');
  if (!hasUsers) {
    for (const [u, n, r, p] of [['gerant','Gérant','gerant','0000'],['superviseur','Superviseur','superviseur','2345'],['caissier','Caissier','caissier','1234']]) {
      await q('INSERT INTO users(username,name,role,pwd) VALUES($1,$2,$3,$4)', [u, n, r, await hashPwd(p)]);
    }
  }

  const hasCatalog = await q1('SELECT 1 FROM catalog LIMIT 1');
  if (!hasCatalog) {
    const items = [
      ['CHEMISE / H',1000,2000,'👔','Hauts'],['PANTALON',1000,2000,'👖','Bas'],['ROBE SIMPLE',2500,5000,'👗','Robes'],
      ['COSTUME 2P',3000,6000,'🤵','Costumes'],['VESTE / H',2200,2500,'🧥','Hauts'],['JUPE SIMPLE',1000,2000,'👗','Bas'],
      ['POLO',1000,2000,'👔','Hauts'],['MANTEAU SIMPLE',2500,5000,'🧥','Manteaux'],['DRAP HOUSSE',1000,2000,'🛏️','Linge maison'],
      ['PAIRE DE CHAUSSURES',1500,3000,'👟','Accessoires'],['CRAVATE',1000,2000,'🎀','Accessoires'],['COSTUME ENFANT',2000,4000,'🧒','Costumes'],
      ['RIDEAU',4000,8000,'🪟','Linge maison'],['PULL-OVER',1000,2000,'🧶','Hauts'],['COUVERTURE / CVLT',4500,9000,'🛏️','Linge maison']
    ];
    for (const [n, p, pe, i, c] of items) await q('INSERT INTO catalog(name,price,price_express,icon,category) VALUES($1,$2,$3,$4,$5)', [n, p, pe, i, c]);
  }

  const DEFAULTS = { shop_name:'Light Pressing', shop_address:'Kribi, Dombe après La scierie MMG', shop_phone:'(+237) 696 52 86 10 / 672 38 08 03', shop_niu:'',
    kilo_price:'700', default_delay:'2', invoice_seq:'1', order_seq:'0',
    max_discount_percent:'100',
    invoice_format:'A6', invoice_logo:'', invoice_header:'', invoice_footer:'Merci de votre confiance !' };
  for (const [k, v] of Object.entries(DEFAULTS))
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [k, v]);
}

module.exports = { pool, q, q1, qAll, initDB };
