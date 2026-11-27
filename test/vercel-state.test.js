'use strict';
// Plusieurs instances « Vercel » sur la même base : l'état qui était gardé
// en mémoire (permissions, anti-bruteforce) doit être partagé.
//
// Chaque instance est lancée comme sur Vercel : VERCEL=1, server.js exporte
// l'app sans appeler start(), et l'init de la base se fait à la première
// requête /api (middleware lazy).

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const ROOT = path.join(__dirname, '..');
const DB = 'pp_vercel_state';
const TTL_MS = 300;
let nextPort = 4000 + Math.floor(Math.random() * 50);

function dbUrl(name) { const u = new URL(ADMIN_URL); u.pathname = '/' + name; return u.toString(); }
async function admin(text) {
  const c = new Client({ connectionString: ADMIN_URL }); await c.connect();
  try { return await c.query(text); } finally { await c.end(); }
}
async function sql(text, params) {
  const c = new Client({ connectionString: dbUrl(DB) }); await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startVercelInstance() {
  const port = nextPort++;
  const script = `const app = require('./server.js'); app.listen(${port}, '127.0.0.1', () => console.log('instance prête'));`;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, VERCEL: '1', VERCEL_ENV: '', NODE_ENV: '', INITIAL_ADMIN_PASSWORD: '', DATABASE_URL: dbUrl(DB), SESSION_SECRET: 'test-secret', PERMISSIONS_TTL_MS: String(TTL_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('instance non démarrée :\n' + out)), 20000);
    child.stdout.on('data', () => { if (out.includes('instance prête')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`instance arrêtée (${code}) :\n${out}`)); });
  }).then(() => ({
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }),
  }));
}

// Client HTTP avec cookie ; `ip` simule l'en-tête que Vercel ajoute.
function client(base, ip = '203.0.113.10') {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
async function login(base, username, password, ip) {
  const call = client(base, ip);
  const r = await call('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, `connexion ${username} : ${JSON.stringify(r.data)}`);
  if (r.data.user.must_change) await sql('UPDATE users SET must_change=false WHERE username=$1', [username]);
  return call;
}

describe('plusieurs instances Vercel sur la même base', () => {
  let A, B;
  before(async () => {
    await admin(`DROP DATABASE IF EXISTS ${DB}`);
    await admin(`CREATE DATABASE ${DB}`);
    A = await startVercelInstance();
    B = await startVercelInstance();
  });
  after(async () => {
    if (A) await A.stop();
    if (B) await B.stop();
    await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  });

  test('une permission modifiée sur A est appliquée sur B', async () => {
    const gerantA = await login(A.base, 'gerant', '0000', '198.51.100.1');
    const caissierB = await login(B.base, 'caissier', '1234', '198.51.100.2');

    let r = await caissierB('GET', '/api/stats');
    assert.equal(r.status, 403, 'le caissier ne voit pas les stats par défaut');

    r = await gerantA('PUT', '/api/permissions', { caissier: { 'stats.view': true } });
    assert.equal(r.status, 200, JSON.stringify(r.data));

    await sleep(TTL_MS + 100);
    r = await caissierB('GET', '/api/stats');
    assert.equal(r.status, 200, 'B voit la permission accordée sur A');
    r = await caissierB('GET', '/api/bootstrap');
    assert.equal(r.data.permissions['stats.view'], true, 'le menu de B reflète aussi la permission');

    // Retour aux permissions par défaut : la ligne en base ne contient plus rien
    r = await gerantA('PUT', '/api/permissions', {});
    assert.equal(r.status, 200);
    await sleep(TTL_MS + 100);
    r = await caissierB('GET', '/api/stats');
    assert.equal(r.status, 403, 'B retire la permission retirée sur A');
  });

  test('5 échecs répartis sur A et B bloquent la connexion partout', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 5; i++) {
      const srv = i % 2 ? B : A;
      const r = await client(srv.base, ip)('POST', '/api/login', { username: 'superviseur', password: 'faux' + i });
      assert.equal(r.status, 401, `échec ${i + 1}`);
    }
    // Même avec le bon mot de passe, depuis cette IP : bloqué, sur les deux instances
    for (const srv of [A, B]) {
      const r = await client(srv.base, ip)('POST', '/api/login', { username: 'superviseur', password: '2345' });
      assert.equal(r.status, 429, JSON.stringify(r.data));
    }
    // Le nom d'utilisateur est aussi bloqué depuis une autre IP
    let r = await client(B.base, '203.0.113.51')('POST', '/api/login', { username: 'superviseur', password: '2345' });
    assert.equal(r.status, 429);
    // Mais une autre IP peut se connecter avec un autre compte
    r = await client(A.base, '203.0.113.52')('POST', '/api/login', { username: 'gerant', password: '0000' });
    assert.equal(r.status, 200, JSON.stringify(r.data));

    // Fin du blocage → la connexion remarche et remet les compteurs à zéro
    await sql("UPDATE login_attempts SET blocked_until = now() - interval '1 second'");
    r = await client(A.base, ip)('POST', '/api/login', { username: 'superviseur', password: '2345' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const left = await sql("SELECT key FROM login_attempts WHERE key IN ('ip:203.0.113.50','u:superviseur')");
    assert.equal(left.rowCount, 0, 'compteurs effacés après une connexion réussie');
  });

  test('des échecs anciens ne comptent plus (fenêtre de 15 min)', async () => {
    const ip = '203.0.113.60';
    for (let i = 0; i < 4; i++)
      await client(A.base, ip)('POST', '/api/login', { username: 'caissier', password: 'x' });
    await sql("UPDATE login_attempts SET updated_at = now() - interval '20 minutes'");
    // 5e échec, mais les 4 premiers sont trop vieux : pas de blocage
    await client(B.base, ip)('POST', '/api/login', { username: 'caissier', password: 'x' });
    const r = await client(B.base, ip)('POST', '/api/login', { username: 'caissier', password: '1234' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });

  test('des échecs simultanés sont tous comptés', async () => {
    const ip = '203.0.113.70';
    await Promise.all([A, B, A, B, A].map((srv) =>
      client(srv.base, ip)('POST', '/api/login', { username: 'inconnu', password: 'x' })));
    const r = await client(A.base, ip)('POST', '/api/login', { username: 'gerant', password: '0000' });
    assert.equal(r.status, 429, 'les 5 échecs parallèles ont déclenché le blocage');
  });
});
