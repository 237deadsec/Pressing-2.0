'use strict';
// Test de fumée : démarre le vrai serveur contre un vrai PostgreSQL et
// parcourt les parcours principaux de la caisse.
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
//
// TEST_DATABASE_URL doit pointer vers une base d'administration : chaque
// scénario crée sa propre base jetable, puis la supprime.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const ROOT = path.join(__dirname, '..');
let nextPort = 3900 + Math.floor(Math.random() * 50);

function dbUrl(name) {
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + name;
  return u.toString();
}

async function withAdmin(fn) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function sql(name, text, params) {
  const c = new Client({ connectionString: dbUrl(name) });
  await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
}

async function createDb(name) {
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS ${name}`));
  await withAdmin((c) => c.query(`CREATE DATABASE ${name}`));
}

async function dropDb(name) {
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

// Démarre `node server.js` et attend qu'il écoute. Échoue si le processus
// s'arrête avant (ex. « Impossible de démarrer : … »).
function startServer(name, databaseUrl = dbUrl(name)) {
  const port = nextPort++;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), SESSION_SECRET: 'test-secret', VERCEL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Serveur non démarré après 20 s :\n' + output)), 20000);
    child.stdout.on('data', () => {
      if (output.includes('démarré')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Serveur arrêté (code ${code}) :\n${output}`)); });
  });
  return ready.then(() => ({
    base: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }),
  }));
}

function client(base) {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

async function login(base, username, password) {
  const call = client(base);
  const r = await call('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, `connexion ${username} : ${JSON.stringify(r.data)}`);
  return call;
}

// Parcours métier complet, commun aux deux scénarios.
async function businessFlow(srv, dbName) {
  const call = await login(srv.base, 'gerant', '0000');

  let r = await call('POST', '/api/password', { current: '0000', password: 'nouveau-mdp' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  r = await call('GET', '/api/bootstrap');
  assert.equal(r.status, 200);
  assert.ok(r.data.catalog.length > 0, 'catalogue initial présent');
  const item = r.data.catalog[0];

  // Commande à l'article, à crédit avec acompte
  r = await call('POST', '/api/orders', {
    client: 'Client Test', phone: '699000001', payment: 'Crédit', type: 'article',
    items: [{ id: item.id, qty: 3 }], acompte: 500, acompte_method: 'Espèces',
    discount: 100, discount_reason: 'fidélité',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const order = r.data;
  assert.equal(order.total, item.price * 3 - 100);
  assert.equal(order.balance, order.total - 500);

  // Commande au kilo
  r = await call('POST', '/api/orders', {
    client: 'Client Kilo', phone: '699000002', payment: 'Mobile Money', type: 'kilo',
    weight: 2.5, kilo_items: '3 draps', promise_date: '2030-01-01',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.kilo_items, '3 draps');

  // Paiement du solde
  r = await call('POST', `/api/orders/${order.id}/pay`, { amount: order.balance, method: 'Mobile Money' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.balance, 0);

  // Cycle de statuts jusqu'à la livraison (facture numérotée)
  for (const status of ['traitement', 'pret', 'livre']) {
    r = await call('PUT', `/api/orders/${order.id}/status`, { status, note: 'ok' });
    assert.equal(r.status, 200, `${status} : ${JSON.stringify(r.data)}`);
  }
  assert.equal(r.data.status, 'livre');
  assert.ok(r.data.invoice_no, 'numéro de facture attribué');

  // Suivi public
  r = await call('GET', `/api/track/${order.track_token}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'livre');

  // Changement de prix + historique (P3.1) : faisait planter le serveur
  r = await call('PUT', `/api/catalog/${item.id}`, {
    name: item.name, price: item.price + 250, price_express: (item.price_express || 0) + 500,
    icon: item.icon, category: item.category,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call('GET', `/api/catalog/${item.id}/price-history`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].new_price, item.price + 250);
  assert.equal(r.data[0].changed_by_name, 'gerant');

  // Clients et abonnements
  r = await call('GET', '/api/clients');
  assert.equal(r.status, 200);
  const cli = (Array.isArray(r.data) ? r.data : r.data.clients || r.data.rows || []).find((c) => c.name === 'Client Test');
  assert.ok(cli, 'client créé avec la commande');
  r = await call('POST', '/api/subscriptions', { client_id: cli.id, plan_name: 'Forfait 10', total_articles: 10, amount_paid: 8000 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await call('POST', `/api/subscriptions/${r.data.id}/use`, { quantity: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.used_articles, 2);

  // Écrans de lecture : chacun touche d'autres colonnes du schéma
  for (const url of ['/api/orders', `/api/orders/${order.id}`, `/api/orders/${order.id}/payments`, '/api/stats',
    '/api/late-orders', '/api/reports', '/api/creances', '/api/activity-log', '/api/backup', '/api/users',
    '/api/permissions', '/api/subscriptions', `/api/clients/${cli.id}`]) {
    r = await call('GET', url);
    assert.equal(r.status, 200, `${url} : ${JSON.stringify(r.data).slice(0, 300)}`);
  }

  // Paramètres : réservés au gérant (étaient ouverts à tous depuis P3.6)
  const anon = client(srv.base);
  r = await anon('PUT', '/api/settings', { shop_name: 'X', kilo_price: 1, default_delay: 1, max_discount_percent: 100 });
  assert.equal(r.status, 401);
  const caissier = await login(srv.base, 'caissier', '1234');
  r = await caissier('PUT', '/api/settings', { shop_name: 'X', kilo_price: 1, default_delay: 1, max_discount_percent: 100 });
  assert.equal(r.status, 403);
  r = await call('PUT', '/api/settings', { shop_name: 'Light Pressing', kilo_price: 800, default_delay: 2, max_discount_percent: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Une erreur SQL dans une route renvoie 500 sans tuer le processus
  await sql(dbName, 'ALTER TABLE price_history RENAME TO price_history_off');
  try {
    r = await call('PUT', `/api/catalog/${item.id}`, { name: item.name, price: item.price + 999, category: item.category });
    assert.equal(r.status, 500);
    assert.deepEqual(r.data, { error: 'Erreur serveur' });
  } finally {
    await sql(dbName, 'ALTER TABLE price_history_off RENAME TO price_history');
  }
  r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.ok(srv.alive(), 'le serveur tourne toujours');

  return { call, order };
}

describe('base vierge', () => {
  const name = 'pp_smoke_fresh';
  let srv;
  before(async () => { await createDb(name); srv = await startServer(name); });
  after(async () => { if (srv) await srv.stop(); await dropDb(name); });

  test('démarre et crée les comptes initiaux', async () => {
    const { rows } = await sql(name, 'SELECT username, role, must_change FROM users ORDER BY id');
    assert.deepEqual(rows.map((u) => u.username), ['gerant', 'superviseur', 'caissier']);
  });

  test('parcours caisse complet', async () => {
    await businessFlow(srv, name);
  });
});

describe('base existante (schéma de production)', () => {
  const name = 'pp_smoke_legacy';
  let srv;
  before(async () => {
    await createDb(name);
    const c = new Client({ connectionString: dbUrl(name) });
    await c.connect();
    await c.query(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-prod.sql'), 'utf8'));
    await c.end();
    srv = await startServer(name);
  });
  after(async () => { if (srv) await srv.stop(); await dropDb(name); });

  test('conserve les données existantes', async () => {
    const call = await login(srv.base, 'gerant', '0000');
    const r = await call('GET', '/api/orders/1');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.client_name, 'Awa');
    assert.equal(r.data.total, 2000);
  });

  test('répare la table price_history laissée par P3.6', async () => {
    const { rows } = await sql(name, `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='price_history' ORDER BY column_name`);
    const cols = Object.fromEntries(rows.map((x) => [x.column_name, x.data_type]));
    assert.equal(cols.changed_by, 'integer');
    assert.ok(cols.old_price_express && cols.new_price_express && cols.changed_at);
  });

  test('parcours caisse complet', async () => {
    await businessFlow(srv, name);
  });

  test('redémarrer est sans effet sur le schéma (initDB idempotent)', async () => {
    const snapshot = () => sql(name, `
      SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='orders') AS cons,
             (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS idx,
             (SELECT count(*) FROM information_schema.columns WHERE table_schema='public') AS cols,
             (SELECT count(*) FROM orders) AS orders`).then((r) => r.rows[0]);
    const before1 = await snapshot();
    await srv.stop();
    srv = await startServer(name);
    assert.deepEqual(await snapshot(), before1);
  });
});

// Reproduit les droits de la production Supabase : l'application se connecte
// avec un rôle qui possède toutes les tables SAUF price_history (créée à la
// main par « postgres », avec la RLS activée et sans policy). Un ALTER TABLE
// ou CREATE INDEX lancé « au cas où » par initDB y échoue avec
// « must be owner of table price_history » et l'API entière tombe en 503.
describe('rôle applicatif non propriétaire (droits de production)', () => {
  const name = 'pp_smoke_roles';
  const role = 'pp_smoke_app';
  let srv, appUrl;
  before(async () => {
    await createDb(name);
    await withAdmin(async (c) => {
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} LOGIN PASSWORD 'pp_smoke_pwd' NOSUPERUSER NOBYPASSRLS;
        END IF; END $$`);
    });
    const c = new Client({ connectionString: dbUrl(name) });
    await c.connect();
    await c.query(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-prod.sql'), 'utf8'));
    await c.query(`
      SET search_path = public;
      GRANT USAGE, CREATE ON SCHEMA public TO ${role};
      DROP TABLE price_history;
      CREATE TABLE price_history (
        id SERIAL PRIMARY KEY,
        catalog_id integer NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
        old_price integer NOT NULL, new_price integer NOT NULL,
        old_price_express integer DEFAULT 0 NOT NULL, new_price_express integer DEFAULT 0 NOT NULL,
        changed_by integer REFERENCES users(id),
        changed_at timestamptz DEFAULT now() NOT NULL);
      CREATE INDEX idx_price_history_catalog ON price_history(catalog_id);
      ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON price_history TO ${role};
      GRANT USAGE ON SEQUENCE price_history_id_seq TO ${role};`);
    for (const t of ['users', 'catalog', 'clients', 'orders', 'payments', 'status_history', 'settings', 'subscriptions', 'activity_log'])
      await c.query(`ALTER TABLE ${t} OWNER TO ${role}`);
    await c.end();
    const u = new URL(dbUrl(name));
    u.username = role; u.password = 'pp_smoke_pwd';
    appUrl = u.toString();
    srv = await startServer(name, appUrl);
  });
  after(async () => {
    if (srv) await srv.stop();
    await dropDb(name);
    await withAdmin((c) => c.query(`DROP ROLE IF EXISTS ${role}`));
  });

  test('démarre sans lancer de DDL sur price_history', async () => {
    const call = await login(srv.base, 'gerant', '0000');
    const r = await call('GET', '/api/bootstrap');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const h = await call('GET', '/api/health');
    assert.equal(h.status, 200);
  });

  test('parcours caisse complet une fois price_history rendue au rôle applicatif', async () => {
    // Correctif appliqué en production : ALTER TABLE price_history OWNER TO <rôle app>
    await sql(name, `ALTER TABLE price_history OWNER TO ${role}`);
    await businessFlow(srv, name);
  });
});
