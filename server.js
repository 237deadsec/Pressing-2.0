'use strict';
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ══════════════════════════════════════════════════════════════════
   1. CONFIGURATION
   ══════════════════════════════════════════════════════════════════ */
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL requise'); process.exit(1); }
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const ROLES = ['caissier', 'superviseur', 'gerant'];
const STATUSES = ['depose', 'traitement', 'pret', 'livre', 'annule'];
const PAYMENT_MODES = ['Espèces', 'Mobile Money', 'Crédit'];
const PAYMENT_METHODS = ['Espèces', 'Mobile Money'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pipeline strict : seules ces transitions sont autorisées
const TRANSITIONS = {
  depose:     ['traitement'],
  traitement: ['pret'],
  pret:       ['livre'],
  livre:      [],     // terminal
  annule:     [],     // terminal
};
// annulation possible depuis tout sauf livre/annule
const CANCELLABLE = ['depose', 'traitement', 'pret'];

const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fail = (res, m, c = 400) => res.status(c).json({ error: m });

/* ── P3.2 — Permissions fines par module ── */
const DEFAULT_PERMISSIONS = {
  caissier: {
    'orders.create': true, 'orders.view': true, 'orders.edit': false,
    'orders.cancel': false, 'orders.status': true,
    'payments.create': true, 'payments.view': true,
    'clients.view': true, 'clients.create': false, 'clients.edit': false,
    'catalog.view': true, 'catalog.manage': false,
    'subscriptions.view': false, 'subscriptions.manage': false, 'subscriptions.use': true,
    'stats.view': false, 'reports.view': false, 'reports.export': false,
    'creances.view': false, 'settings.manage': false,
    'users.manage': false, 'activity.view': false, 'backup.create': false
  },
  superviseur: {
    'orders.create': true, 'orders.view': true, 'orders.edit': true,
    'orders.cancel': true, 'orders.status': true,
    'payments.create': true, 'payments.view': true,
    'clients.view': true, 'clients.create': true, 'clients.edit': true,
    'catalog.view': true, 'catalog.manage': false,
    'subscriptions.view': true, 'subscriptions.manage': true, 'subscriptions.use': true,
    'stats.view': true, 'reports.view': false, 'reports.export': false,
    'creances.view': true, 'settings.manage': false,
    'users.manage': false, 'activity.view': false, 'backup.create': false
  },
  gerant: {
    'orders.create': true, 'orders.view': true, 'orders.edit': true,
    'orders.cancel': true, 'orders.status': true,
    'payments.create': true, 'payments.view': true,
    'clients.view': true, 'clients.create': true, 'clients.edit': true,
    'catalog.view': true, 'catalog.manage': true,
    'subscriptions.view': true, 'subscriptions.manage': true, 'subscriptions.use': true,
    'stats.view': true, 'reports.view': true, 'reports.export': true,
    'creances.view': true, 'settings.manage': true,
    'users.manage': true, 'activity.view': true, 'backup.create': true
  }
};

// In-memory permissions — merged from DB on startup
let PERMISSIONS = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));

async function loadPermissions() {
  const row = await q1("SELECT value FROM settings WHERE key='permissions'");
  if (row && row.value) {
    try {
      const custom = JSON.parse(row.value);
      // Merge custom over defaults: keep any new permission keys from defaults
      for (const role of ROLES) {
        PERMISSIONS[role] = { ...DEFAULT_PERMISSIONS[role], ...(custom[role] || {}) };
      }
    } catch (e) { console.error('Invalid permissions JSON in settings:', e.message); }
  }
}

function hasPermission(role, perm) {
  return !!(PERMISSIONS[role] && PERMISSIONS[role][perm]);
}

/* ══════════════════════════════════════════════════════════════════
   2. DATABASE
   ══════════════════════════════════════════════════════════════════ */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') || DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});

const q = (text, params) => pool.query(text, params);
const q1 = async (text, params) => (await q(text, params)).rows[0] || null;
const qAll = async (text, params) => (await q(text, params)).rows;

async function initDB() {
  await q(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('caissier','superviseur','gerant')),
      pwd TEXT NOT NULL, must_change BOOLEAN DEFAULT true, active BOOLEAN DEFAULT true);

    CREATE TABLE IF NOT EXISTS catalog(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL,
      price_express INTEGER DEFAULT 0,
      icon TEXT DEFAULT '🧺', active BOOLEAN DEFAULT true);

    CREATE TABLE IF NOT EXISTS clients(
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '');

    CREATE TABLE IF NOT EXISTS orders(
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('article','kilo')),
      client_id INTEGER REFERENCES clients(id), client_name TEXT NOT NULL, phone TEXT DEFAULT '',
      items JSONB, weight NUMERIC(10,2), price_kg INTEGER, kilo_items TEXT,
      subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, discount_reason TEXT,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'depose' CHECK(status IN ('depose','traitement','pret','livre','annule')),
      payment_mode TEXT NOT NULL CHECK(payment_mode IN ('Espèces','Mobile Money','Crédit')),
      promise_date TEXT, day TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      delivered_at TEXT, invoice_no TEXT, track_token TEXT UNIQUE);

    CREATE INDEX IF NOT EXISTS ix_orders_track ON orders(track_token);
    CREATE INDEX IF NOT EXISTS ix_orders_day ON orders(day);
    CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS payments(
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      amount INTEGER NOT NULL CHECK(amount > 0),
      method TEXT NOT NULL CHECK(method IN ('Espèces','Mobile Money')),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL);

    CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(order_id);

    CREATE TABLE IF NOT EXISTS status_history(
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      old_status TEXT, new_status TEXT NOT NULL,
      changed_at TEXT NOT NULL, changed_by TEXT NOT NULL, note TEXT);

    CREATE INDEX IF NOT EXISTS ix_sh_order ON status_history(order_id);

    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  `);

  // Migrations
  try { await q("ALTER TABLE orders ADD COLUMN IF NOT EXISTS track_token TEXT UNIQUE"); } catch(e) {}
  try { await q("CREATE INDEX IF NOT EXISTS ix_orders_track ON orders(track_token)"); } catch(e) {}
  try { await q("ALTER TABLE catalog ADD COLUMN IF NOT EXISTS price_express INTEGER DEFAULT 0"); } catch(e) {}
  // P1.2 — clients: email, address, notes
  try { await q("ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''"); } catch(e) {}
  try { await q("ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''"); } catch(e) {}
  try { await q("ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''"); } catch(e) {}
  try { await q("CREATE INDEX IF NOT EXISTS ix_orders_client ON orders(client_id)"); } catch(e) {}
  // P2.1 — catalog categories
  try { await q("ALTER TABLE catalog ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Divers'"); } catch(e) {}

  // P2.2 — subscriptions
  try { await q(`CREATE TABLE IF NOT EXISTS subscriptions(
    id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
    plan_name TEXT NOT NULL, total_articles INTEGER NOT NULL CHECK(total_articles > 0),
    used_articles INTEGER NOT NULL DEFAULT 0, amount_paid INTEGER NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'actif' CHECK(status IN ('actif','expiré','épuisé','annulé')),
    created_at TEXT NOT NULL, created_by TEXT NOT NULL, notes TEXT DEFAULT ''
  )`); } catch(e) {}
  try { await q("CREATE INDEX IF NOT EXISTS ix_subs_client ON subscriptions(client_id)"); } catch(e) {}

  // P2.4 — activity_log (journal d'activités)
  try { await q(`CREATE TABLE IF NOT EXISTS activity_log(
    id SERIAL PRIMARY KEY, action TEXT NOT NULL, entity TEXT,
    entity_id INTEGER, detail TEXT DEFAULT '', user_name TEXT NOT NULL,
    user_role TEXT NOT NULL, created_at TEXT NOT NULL
  )`); } catch(e) {}
  try { await q("CREATE INDEX IF NOT EXISTS ix_actlog_created ON activity_log(created_at DESC)"); } catch(e) {}

  // Données initiales
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

/* ══════════════════════════════════════════════════════════════════
   3. PASSWORD & TOKEN
   ══════════════════════════════════════════════════════════════════ */
const scryptAsync = (pw, salt, len) => new Promise((ok, ko) =>
  crypto.scrypt(pw, salt, len, (e, k) => e ? ko(e) : ok(k)));

async function hashPwd(p) {
  const s = crypto.randomBytes(16).toString('hex');
  const k = await scryptAsync(p, s, 64);
  return s + ':' + k.toString('hex');
}
async function checkPwd(p, h) {
  const [s, k] = String(h).split(':');
  if (!s || !k) return false;
  const a = Buffer.from(k, 'hex'), b = await scryptAsync(p, s, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sign = d => crypto.createHmac('sha256', SESSION_SECRET).update(d).digest('base64url');
const makeToken = u => {
  const p = Buffer.from(JSON.stringify({ id: u.id, exp: Date.now() + 12 * 3600e3 })).toString('base64url');
  return p + '.' + sign(p);
};
const readToken = t => {
  if (!t) return null;
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  const a = Buffer.from(sign(p)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() ? d : null; }
  catch { return null; }
};

/* ══════════════════════════════════════════════════════════════════
   4. HELPERS
   ══════════════════════════════════════════════════════════════════ */
const getS = async k => (await q1('SELECT value FROM settings WHERE key=$1', [k]))?.value;
const setS = (k, v) => q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, String(v)]);

/* P2.4 — journal d'activités helper */
async function logActivity(user, action, entity, entityId, detail) {
  try {
    await q('INSERT INTO activity_log(action,entity,entity_id,detail,user_name,user_role,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [action, entity||null, entityId||null, String(detail||'').slice(0,500), user.name, user.role, new Date().toISOString()]);
  } catch(e) { console.error('logActivity err:', e.message); }
}

async function publicSettings() {
  return {
    shop_name: await getS('shop_name'), shop_address: await getS('shop_address'),
    shop_phone: await getS('shop_phone'), shop_niu: await getS('shop_niu'),
    kilo_price: +(await getS('kilo_price')), default_delay: +(await getS('default_delay')),
    max_discount_percent: +(await getS('max_discount_percent') || '100'),
    invoice_format: await getS('invoice_format') || 'A6',
    invoice_logo: await getS('invoice_logo') || '',
    invoice_header: await getS('invoice_header') || '',
    invoice_footer: await getS('invoice_footer') || 'Merci de votre confiance !'
  };
}
const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, must_change: !!u.must_change });

async function orderWithPayments(id) {
  const o = await q1('SELECT * FROM orders WHERE id=$1', [id]);
  if (!o) return null;
  if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
  o.weight = o.weight ? Number(o.weight) : null;
  const payments = await qAll('SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [id]);
  o.paid_total = payments.reduce((s, p) => s + p.amount, 0);
  o.balance = o.total - o.paid_total;
  o.payments = payments;
  const history = await qAll('SELECT * FROM status_history WHERE order_id=$1 ORDER BY id', [id]);
  o.status_history = history;
  return o;
}

async function nextOrderCode(day) {
  // Atomique : incrémente le compteur et retourne la nouvelle valeur
  const r = await q1("UPDATE settings SET value = (CAST(value AS INTEGER)+1)::TEXT WHERE key='order_seq' RETURNING value");
  const n = parseInt(r.value);
  return 'LP-' + day.slice(2).replace(/-/g, '') + '-' + String(n).padStart(4, '0');
}

async function nextInvoiceNo() {
  const r = await q1("UPDATE settings SET value = (CAST(value AS INTEGER)+1)::TEXT WHERE key='invoice_seq' RETURNING value");
  return 'FAC-' + String(parseInt(r.value)).padStart(5, '0');
}

/* ══════════════════════════════════════════════════════════════════
   5. EXPRESS APP
   ══════════════════════════════════════════════════════════════════ */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' })); // 2mb pour logo base64

// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));

// Trust proxy (Cloudflare Tunnel, NGINX, Vercel)
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

/* ── DB init lazy (Vercel : exécuté à la première requête API) ── */
let _dbReady = false, _dbInitP = null;
app.use('/api', async (req, res, next) => {
  if (_dbReady) return next();
  if (!_dbInitP) _dbInitP = initDB().then(() => loadPermissions()).then(() => { _dbReady = true; console.log('DB init OK'); }).catch(e => { _dbInitP = null; console.error('DB init FAIL:', e.message); throw e; });
  try { await _dbInitP; } catch (e) { return res.status(503).json({ error: 'Base de données indisponible: ' + e.message }); }
  next();
});

/* ── Auth middleware ── */
const auth = (...rolesOrPerms) => async (req, res, next) => {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(x => { const i = x.indexOf('='); if (i > 0) c[x.slice(0, i).trim()] = x.slice(i + 1).trim(); });
  const d = readToken(c.pp_session);
  if (!d) return fail(res, 'Non authentifié', 401);
  const u = await q1('SELECT id,username,name,role,must_change FROM users WHERE id=$1 AND active=true', [d.id]);
  if (!u) return fail(res, 'Non authentifié', 401);
  // P3.2 — Support both role names and permission keys (contain a dot)
  if (rolesOrPerms.length) {
    const perms = rolesOrPerms.filter(x => x.includes('.'));
    const roles = rolesOrPerms.filter(x => !x.includes('.'));
    if (perms.length) {
      // Permission-based check: user must have at least one of the listed permissions
      const ok = perms.some(p => hasPermission(u.role, p));
      if (!ok) return fail(res, 'Accès refusé', 403);
    } else if (roles.length) {
      // Legacy role-based check
      if (!roles.includes(u.role)) return fail(res, 'Accès refusé', 403);
    }
  }
  req.user = u;
  next();
};

/* ── Rate limiting par IP + username ── */
const fails = new Map();
setInterval(() => { // Nettoyage toutes les 10 min
  const now = Date.now();
  for (const [k, v] of fails) if (v.until < now && v.n === 0) fails.delete(k);
}, 600e3);

/* ══════════════════════════════════════════════════════════════════
   6. AUTH ROUTES
   ══════════════════════════════════════════════════════════════════ */
app.post('/api/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return fail(res, 'Trop de tentatives. Réessayez dans quelques minutes.', 429);

  const { username = '', password = '' } = req.body || {};
  const uStr = String(username).trim(), pStr = String(password);
  if (!uStr || !pStr) return fail(res, 'Identifiants requis');
  if (pStr.length > 200) return fail(res, 'Mot de passe invalide'); // DoS prevention

  const u = await q1('SELECT * FROM users WHERE username=$1 AND active=true', [uStr]);
  if (!u || !(await checkPwd(pStr, u.pwd))) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; }
    fails.set(ip, f);
    // Rate limit aussi par username pour empêcher brute-force distribué
    if (uStr) { const uf = fails.get('u:' + uStr) || { n: 0, until: 0 }; uf.n++; if (uf.n >= 5) { uf.until = Date.now() + 5 * 60e3; uf.n = 0; } fails.set('u:' + uStr, uf); }
    return fail(res, 'Identifiants incorrects', 401);
  }
  fails.delete(ip);
  fails.delete('u:' + uStr);
  res.setHeader('Set-Cookie', `pp_session=${makeToken(u)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  logActivity(u, 'login', 'user', u.id, `Connexion depuis ${ip}`);
  res.json({ user: pub(u) });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'pp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/bootstrap', auth(), async (req, res) => {
  const perms = PERMISSIONS[req.user.role] || {};
  res.json({
    user: pub(req.user), settings: await publicSettings(),
    catalog: await qAll('SELECT id,name,price,price_express,icon,category FROM catalog WHERE active=true ORDER BY category,name'),
    permissions: perms
  });
});

app.post('/api/password', auth(), async (req, res) => {
  const { current = '', password = '' } = req.body || {};
  if (String(password).length > 200) return fail(res, 'Mot de passe trop long');
  const u = await q1('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await checkPwd(String(current), u.pwd))) return fail(res, 'Mot de passe actuel incorrect');
  if (String(password).length < 6) return fail(res, 'Nouveau mot de passe : 6 caractères minimum');
  if (password === current) return fail(res, 'Choisissez un mot de passe différent');
  await q('UPDATE users SET pwd=$1,must_change=false WHERE id=$2', [await hashPwd(String(password)), u.id]);
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════
   7. CATALOGUE
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/catalog', auth(), async (req, res) =>
  res.json(await qAll('SELECT id,name,price,price_express,icon,category FROM catalog WHERE active=true ORDER BY category,name')));

app.post('/api/catalog', auth('catalog.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim(), price = Math.round(+req.body?.price);
  const price_express = Math.round(+req.body?.price_express || 0);
  const icon = String(req.body?.icon || '🧺').trim().slice(0, 4) || '🧺';
  if (!name || !(price >= 0)) return fail(res, 'Nom et prix valides requis');
  const category = String(req.body?.category || 'Divers').trim().slice(0, 50) || 'Divers';
  await q('INSERT INTO catalog(name,price,price_express,icon,category) VALUES($1,$2,$3,$4,$5)', [name, price, price_express, icon, category]);
  logActivity(req.user, 'create_catalog', 'catalog', null, `${name} — ${price} FCFA`);
  res.json({ ok: true });
});

app.put('/api/catalog/:id', auth('catalog.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim(), price = Math.round(+req.body?.price);
  const price_express = Math.round(+req.body?.price_express || 0);
  const icon = String(req.body?.icon || '🧺').trim().slice(0, 4) || '🧺';
  if (!name || !(price >= 0)) return fail(res, 'Nom et prix valides requis');
  const category = String(req.body?.category || 'Divers').trim().slice(0, 50) || 'Divers';
  // P3.1 — Record price change in history if price changed
  const old = await q1('SELECT price, price_express FROM catalog WHERE id=$1', [+req.params.id]);
  if (old && (old.price !== price || (old.price_express || 0) !== price_express)) {
    await q('INSERT INTO price_history(catalog_id,old_price,new_price,old_price_express,new_price_express,changed_by) VALUES($1,$2,$3,$4,$5,$6)',
      [+req.params.id, old.price, price, old.price_express || 0, price_express, req.user.id]);
  }
  await q('UPDATE catalog SET name=$1,price=$2,price_express=$3,icon=$4,category=$5 WHERE id=$6', [name, price, price_express, icon, category, +req.params.id]);
  logActivity(req.user, 'update_catalog', 'catalog', +req.params.id, `${name} — ${price} FCFA`);
  res.json({ ok: true });
});

// P3.1 — Price history endpoint
app.get('/api/catalog/:id/price-history', auth('catalog.manage', 'stats.view'), async (req, res) => {
  const rows = await qAll(
    `SELECT ph.id, ph.old_price, ph.new_price, ph.old_price_express, ph.new_price_express,
            ph.changed_at, u.username as changed_by_name
     FROM price_history ph LEFT JOIN users u ON u.id = ph.changed_by
     WHERE ph.catalog_id = $1 ORDER BY ph.changed_at DESC LIMIT 50`,
    [+req.params.id]
  );
  res.json(rows);
});

app.delete('/api/catalog/:id', auth('catalog.manage'), async (req, res) => {
  await q('UPDATE catalog SET active=false WHERE id=$1', [+req.params.id]);
  logActivity(req.user, 'delete_catalog', 'catalog', +req.params.id, '');
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════
   8. PARAMÈTRES
   ══════════════════════════════════════════════════════════════════ */
app.put('/api/settings', auth('settings.manage'), async (req, res) => {
  const b = req.body || {};
  const kp = Math.round(+b.kilo_price), dd = Math.round(+b.default_delay);
  const mdp = Math.round(+b.max_discount_percent);
  if (!(kp > 0)) return fail(res, 'Tarif kilo invalide');
  if (!(dd >= 0 && dd <= 30)) return fail(res, 'Délai invalide (0 à 30 jours)');
  if (!(mdp >= 0 && mdp <= 100)) return fail(res, 'Plafond remise invalide (0 à 100 %)');
  await setS('shop_name', String(b.shop_name || 'Light Pressing').trim().slice(0, 80));
  await setS('shop_address', String(b.shop_address || '').trim().slice(0, 160));
  await setS('shop_phone', String(b.shop_phone || '').trim().slice(0, 40));
  await setS('shop_niu', String(b.shop_niu || '').trim().slice(0, 40));
  await setS('kilo_price', kp);
  await setS('default_delay', dd);
  await setS('max_discount_percent', mdp);
  // Invoice settings
  const ifmt = String(b.invoice_format || 'A6');
  if (!['A4', 'A5', 'A6'].includes(ifmt)) return fail(res, 'Format facture invalide (A4/A5/A6)');
  await setS('invoice_format', ifmt);
  await setS('invoice_header', String(b.invoice_header || '').trim().slice(0, 500));
  await setS('invoice_footer', String(b.invoice_footer || '').trim().slice(0, 300));
  // Logo is saved via dedicated endpoint
  logActivity(req.user, 'update_settings', 'settings', null, 'Paramètres modifiés');
  res.json(await publicSettings());
});

/* ── Logo upload ── */
app.post('/api/settings/logo', auth('settings.manage'), async (req, res) => {
  const logo = String(req.body?.logo || '').trim();
  if (logo && !logo.startsWith('data:image/')) return fail(res, 'Format logo invalide (data:image/… attendu)');
  if (logo.length > 1500000) return fail(res, 'Logo trop volumineux (max ~1 Mo)');
  await setS('invoice_logo', logo);
  res.json({ ok: true });
});

app.delete('/api/settings/logo', auth('settings.manage'), async (req, res) => {
  await setS('invoice_logo', '');
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════
   9. UTILISATEURS
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/users', auth('users.manage'), async (req, res) =>
  res.json(await qAll('SELECT id,username,name,role,active,must_change FROM users ORDER BY id')));

app.post('/api/users', auth('users.manage'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim(), username = String(b.username || '').trim().toLowerCase();
  if (!name) return fail(res, 'Nom requis');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return fail(res, "Identifiant : 3 à 30 caractères (lettres, chiffres . _ -)");
  if (String(b.password || '').length < 6) return fail(res, 'Mot de passe : 6 caractères minimum');
  if (!ROLES.includes(b.role)) return fail(res, 'Rôle invalide');
  try {
    await q('INSERT INTO users(username,name,role,pwd,must_change) VALUES($1,$2,$3,$4,true)', [username, name, b.role, await hashPwd(String(b.password))]);
    logActivity(req.user, 'create_user', 'user', null, `${username} (${b.role})`);
    res.json({ ok: true });
  } catch (e) { fail(res, e.code === '23505' ? 'Cet identifiant existe déjà' : 'Erreur création utilisateur'); }
});

app.put('/api/users/:id', auth('users.manage'), async (req, res) => {
  const t = await q1('SELECT * FROM users WHERE id=$1', [+req.params.id]);
  if (!t) return fail(res, 'Utilisateur introuvable', 404);
  const b = req.body || {};
  const role = b.role !== undefined ? b.role : t.role;
  const active = b.active !== undefined ? !!b.active : t.active;
  if (!ROLES.includes(role)) return fail(res, 'Rôle invalide');
  if (t.id === req.user.id && (role !== 'gerant' || !active)) return fail(res, 'Vous ne pouvez pas modifier votre propre rôle ni vous désactiver');
  if (t.role === 'gerant' && (role !== 'gerant' || !active)) {
    const n = await q1("SELECT COUNT(*)::int c FROM users WHERE role='gerant' AND active=true AND id!=$1", [t.id]);
    if (!n.c) return fail(res, 'Il doit rester au moins un gérant actif');
  }
  let pwd = t.pwd, mc = t.must_change;
  if (b.password !== undefined) {
    if (String(b.password).length < 6) return fail(res, 'Mot de passe : 6 caractères minimum');
    pwd = await hashPwd(String(b.password)); mc = true;
  }
  await q('UPDATE users SET role=$1,active=$2,pwd=$3,must_change=$4 WHERE id=$5', [role, active, pwd, mc, t.id]);
  logActivity(req.user, 'update_user', 'user', t.id, `${t.username} — rôle:${role} actif:${active}`);
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════
   10. COMMANDES
   ══════════════════════════════════════════════════════════════════ */
app.post('/api/orders', auth(), async (req, res) => {
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

  // Remise : superviseur/gérant uniquement, avec raison obligatoire et plafond
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
    // Client : trouver ou créer
    let cr = await client.query('SELECT id FROM clients WHERE lower(name)=lower($1) AND phone=$2', [name, phone]);
    const cid = cr.rows[0]
      ? cr.rows[0].id
      : (await client.query('INSERT INTO clients(name,phone) VALUES($1,$2) RETURNING id', [name, phone])).rows[0].id;

    const day = localDate();
    const code = await nextOrderCode(day);
    const now = new Date().toISOString();
    const trackToken = crypto.randomBytes(12).toString('base64url'); // 16 chars, URL-safe

    const or = await client.query(`INSERT INTO orders(code,type,client_id,client_name,phone,items,weight,price_kg,kilo_items,
      subtotal,discount,discount_reason,total,status,payment_mode,promise_date,day,created_at,created_by,track_token)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'depose',$14,$15,$16,$17,$18,$19) RETURNING id`,
      [code, type, cid, name, phone, items ? JSON.stringify(items) : null, weight, price_kg, kilo_items,
       subtotal, discount, discount_reason, total, b.payment, promise, day, now, u.username, trackToken]);
    const orderId = or.rows[0].id;

    // Historique statut initial
    await client.query('INSERT INTO status_history(order_id,old_status,new_status,changed_at,changed_by) VALUES($1,NULL,$2,$3,$4)',
      [orderId, 'depose', now, u.username]);

    // Paiement : si Espèces/MobileMoney → paiement intégral ; si Crédit → acompte optionnel
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

app.get('/api/orders', auth(), async (req, res) => {
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
  // Enrichir avec paid_total
  for (const o of rows) {
    if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
    o.weight = o.weight ? Number(o.weight) : null;
    const p = await q1('SELECT COALESCE(SUM(amount),0)::int t FROM payments WHERE order_id=$1', [o.id]);
    o.paid_total = p.t;
    o.balance = o.total - p.t;
  }
  res.json({ orders: rows, total: total.c, page: +page, pages: Math.ceil(total.c / limit) });
});

app.get('/api/orders/:id', auth(), async (req, res) => {
  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  res.json(o);
});

/* ── Édition commande (P2.5) — uniquement statut "depose" ── */
app.put('/api/orders/:id', auth('orders.edit'), async (req, res) => {
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

  // Remise
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

  // Vérifier que le total couvre les paiements déjà effectués
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

/* ── Changement de statut (pipeline strict) ── */
app.put('/api/orders/:id/status', auth(), async (req, res) => {
  const st = req.body?.status;
  if (!STATUSES.includes(st)) return fail(res, 'Statut invalide');

  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  const role = req.user.role;

  // Annulation
  if (st === 'annule') {
    if (!CANCELLABLE.includes(o.status)) return fail(res, 'Impossible d\'annuler une commande ' + o.status);
    if (role === 'caissier') return fail(res, 'Annulation réservée au superviseur / gérant', 403);
    if (o.invoice_no && role !== 'gerant') return fail(res, 'Commande facturée : annulation réservée au gérant', 403);
  } else {
    // Transition pipeline stricte
    const allowed = TRANSITIONS[o.status] || [];
    if (!allowed.includes(st)) return fail(res, `Transition ${o.status} → ${st} non autorisée. Transitions possibles : ${allowed.join(', ') || 'aucune'}`);
    // Livraison : vérifier paiement
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
      if (!invoice_no) invoice_no = await nextInvoiceNo();
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

/* ══════════════════════════════════════════════════════════════════
   11. PAIEMENTS PARTIELS
   ══════════════════════════════════════════════════════════════════ */
app.post('/api/orders/:id/pay', auth(), async (req, res) => {
  const method = req.body?.method;
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 'Mode de règlement invalide');
  const amount = Math.round(+req.body?.amount);
  if (!(amount > 0)) return fail(res, 'Montant invalide');

  const o = await orderWithPayments(+req.params.id);
  if (!o) return fail(res, 'Commande introuvable', 404);
  if (o.status === 'annule') return fail(res, 'Commande annulée');
  if (o.balance <= 0) return fail(res, 'Commande déjà intégralement réglée');
  const actual = Math.min(amount, o.balance); // ne pas dépasser le solde

  await q('INSERT INTO payments(order_id,amount,method,created_at,created_by) VALUES($1,$2,$3,$4,$5)',
    [o.id, actual, method, new Date().toISOString(), req.user.username]);
  logActivity(req.user, 'payment', 'order', o.id, `${o.code} — ${actual} FCFA (${method})`);
  res.json(await orderWithPayments(o.id));
});

app.get('/api/orders/:id/payments', auth(), async (req, res) => {
  const payments = await qAll('SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [+req.params.id]);
  res.json(payments);
});

/* ══════════════════════════════════════════════════════════════════
   12. CLIENTS
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/clients', auth(), async (req, res) => {
  res.json(await qAll(`SELECT c.id, c.name, c.phone, COUNT(o.id)::int n, COALESCE(SUM(o.total),0)::int ca,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total - COALESCE(pay.t,0) ELSE 0 END),0)::int due
    FROM clients c LEFT JOIN orders o ON o.client_id=c.id AND o.status!='annule'
    LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    GROUP BY c.id ORDER BY ca DESC`));
});

// P1.2 — Create client standalone
app.post('/api/clients', auth('clients.create'), async (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  if (!name || !name.trim()) return fail(res, 'Nom requis');
  // Check duplicate
  const exists = await q1('SELECT id FROM clients WHERE lower(name)=lower($1) AND phone=$2', [name.trim(), (phone||'').trim()]);
  if (exists) return fail(res, 'Ce client existe déjà');
  const c = await q1(
    'INSERT INTO clients(name,phone,email,address,notes) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,email,address,notes',
    [name.trim(), (phone||'').trim(), (email||'').trim(), (address||'').trim(), (notes||'').trim()]
  );
  logActivity(req.user, 'create_client', 'client', c.id, c.name);
  res.json(c);
});

app.get('/api/clients/search', auth(), async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json([]);
  res.json(await qAll('SELECT id,name,phone FROM clients WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY name LIMIT 10', [`%${search}%`]));
});

// P1.2 — Client detail with order history
app.get('/api/clients/:id', auth(), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, 'ID invalide');
  const client = await q1(`SELECT c.id, c.name, c.phone, COALESCE(c.email,'') email, COALESCE(c.address,'') address, COALESCE(c.notes,'') notes,
    COUNT(o.id)::int total_orders,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total ELSE 0 END),0)::int ca,
    COALESCE(SUM(CASE WHEN o.status!='annule' THEN o.total - COALESCE(pay.t,0) ELSE 0 END),0)::int due
    FROM clients c LEFT JOIN orders o ON o.client_id=c.id
    LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    WHERE c.id=$1 GROUP BY c.id`, [id]);
  if (!client) return fail(res, 'Client introuvable', 404);

  const orders = await qAll(`SELECT o.id, o.code, o.type, o.total, o.status, o.day, o.promise_date,
    COALESCE(pay.t,0)::int paid, (o.total - COALESCE(pay.t,0))::int balance
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) pay ON pay.order_id=o.id
    WHERE o.client_id=$1 ORDER BY o.id DESC LIMIT 50`, [id]);

  res.json({ ...client, orders });
});

// P1.2 — Update client
app.put('/api/clients/:id', auth('clients.edit'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, 'ID invalide');
  const { name, phone, email, address, notes } = req.body;
  if (!name || !name.trim()) return fail(res, 'Nom requis');
  const updated = await q1(
    `UPDATE clients SET name=$1, phone=$2, email=$3, address=$4, notes=$5 WHERE id=$6 RETURNING id,name,phone,email,address,notes`,
    [name.trim(), (phone||'').trim(), (email||'').trim(), (address||'').trim(), (notes||'').trim(), id]
  );
  if (!updated) return fail(res, 'Client introuvable', 404);
  logActivity(req.user, 'update_client', 'client', id, updated.name);
  res.json(updated);
});

// P1.3 — Créances (clients with outstanding balance)
app.get('/api/creances', auth('creances.view'), async (req, res) => {
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

/* ══════════════════════════════════════════════════════════════════
   12b. ABONNEMENTS (P2.2)
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/subscriptions', auth('subscriptions.view'), async (req, res) => {
  const rows = await qAll(`SELECT s.*, c.name AS client_name, c.phone AS client_phone
    FROM subscriptions s JOIN clients c ON c.id=s.client_id ORDER BY s.id DESC`);
  res.json(rows);
});

app.post('/api/subscriptions', auth('subscriptions.manage'), async (req, res) => {
  const { client_id, plan_name, total_articles, amount_paid, end_date, notes } = req.body;
  if (!client_id || !plan_name || !total_articles || total_articles < 1) return res.status(400).json({ error: 'Champs requis manquants' });
  const client = await q1('SELECT id FROM clients WHERE id=$1', [+client_id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  const now = new Date().toISOString();
  const start = localDate();
  const end = end_date || new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);
  const row = await q1(`INSERT INTO subscriptions(client_id, plan_name, total_articles, amount_paid, start_date, end_date, created_at, created_by, notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [+client_id, String(plan_name).trim().slice(0,100), +total_articles, +(amount_paid||0), start, end, now, req.user.name, String(notes||'').slice(0,500)]);
  logActivity(req.user, 'create_subscription', 'subscription', row.id, `${plan_name} — ${total_articles} articles`);
  res.status(201).json(row);
});

app.put('/api/subscriptions/:id', auth('subscriptions.manage'), async (req, res) => {
  const sub = await q1('SELECT * FROM subscriptions WHERE id=$1', [+req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  const { plan_name, total_articles, amount_paid, end_date, status, notes } = req.body;
  const validStatuses = ['actif', 'expiré', 'épuisé', 'annulé'];
  const newStatus = validStatuses.includes(status) ? status : sub.status;
  const row = await q1(`UPDATE subscriptions SET plan_name=$1, total_articles=$2, amount_paid=$3, end_date=$4, status=$5, notes=$6 WHERE id=$7 RETURNING *`,
    [String(plan_name||sub.plan_name).trim().slice(0,100), +(total_articles||sub.total_articles), +(amount_paid||sub.amount_paid), end_date||sub.end_date, newStatus, String(notes??sub.notes).slice(0,500), +req.params.id]);
  logActivity(req.user, 'update_subscription', 'subscription', +req.params.id, `Status: ${newStatus}`);
  res.json(row);
});

app.post('/api/subscriptions/:id/use', auth('subscriptions.use'), async (req, res) => {
  const sub = await q1('SELECT * FROM subscriptions WHERE id=$1', [+req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  if (sub.status !== 'actif') return res.status(400).json({ error: 'Abonnement non actif' });
  const qty = Math.max(1, +(req.body.quantity || 1));
  if (sub.used_articles + qty > sub.total_articles) return res.status(400).json({ error: 'Crédit insuffisant' });
  const newUsed = sub.used_articles + qty;
  const newStatus = newUsed >= sub.total_articles ? 'épuisé' : 'actif';
  const row = await q1('UPDATE subscriptions SET used_articles=$1, status=$2 WHERE id=$3 RETURNING *', [newUsed, newStatus, +req.params.id]);
  logActivity(req.user, 'use_subscription', 'subscription', +req.params.id, `${qty} article(s) utilisé(s) — ${newUsed}/${sub.total_articles}`);
  res.json(row);
});

app.get('/api/clients/:id/subscriptions', auth(), async (req, res) => {
  const rows = await qAll('SELECT * FROM subscriptions WHERE client_id=$1 ORDER BY id DESC', [+req.params.id]);
  res.json(rows);
});

/* ══════════════════════════════════════════════════════════════════
   13. DASHBOARD / STATS / RAPPORTS
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/stats', auth('stats.view'), async (req, res) => {
  const t = localDate();
  const today = await q1("SELECT COALESCE(SUM(total),0)::int ca, COUNT(*)::int n FROM orders WHERE day=$1 AND status!='annule'", [t]);
  const pending = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status IN ('depose','traitement')")).n;
  const ready = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status='pret'")).n;
  const late = (await q1("SELECT COUNT(*)::int n FROM orders WHERE status IN ('depose','traitement','pret') AND promise_date IS NOT NULL AND promise_date<$1", [t])).n;

  const dueR = await q1(`SELECT COALESCE(SUM(o.total - COALESCE(p.t,0)),0)::int v, COUNT(*)::int n
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) p ON p.order_id=o.id
    WHERE o.status!='annule' AND o.total > COALESCE(p.t,0)`);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const r = await q1("SELECT COALESCE(SUM(total),0)::int ca FROM orders WHERE day=$1 AND status!='annule'", [localDate(d)]);
    days.push({ label: d.toLocaleDateString('fr-FR', { weekday: 'short' }), ca: r.ca });
  }
  const byStatus = await qAll('SELECT status, COUNT(*)::int n FROM orders GROUP BY status');
  res.json({ today, pending, ready, late, due: dueR, days, byStatus });
});

// P1.5 — Late orders detail for dashboard alerts
app.get('/api/late-orders', auth('stats.view'), async (req, res) => {
  const t = localDate();
  const rows = await qAll(`
    SELECT o.id, o.code, o.client_name, o.phone, o.status, o.promise_date, o.day,
      (CURRENT_DATE - o.promise_date::date) AS days_late
    FROM orders o
    WHERE o.status IN ('depose','traitement','pret')
      AND o.promise_date IS NOT NULL AND o.promise_date < $1
    ORDER BY o.promise_date ASC LIMIT 50`, [t]);
  res.json(rows);
});

app.get('/api/reports', auth('reports.view'), async (req, res) => {
  const d30 = new Date(); d30.setDate(d30.getDate() - 29);
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : localDate(d30);
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : localDate();

  const rows = await qAll("SELECT * FROM orders WHERE day BETWEEN $1 AND $2 AND status!='annule'", [from, to]);
  for (const o of rows) { if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items); o.weight = o.weight ? Number(o.weight) : null; }

  const ca = rows.reduce((s, o) => s + o.total, 0);
  const byDay = {}, byPay = {}, top = {};
  let kg = 0, caKilo = 0, discounts = 0;
  for (const o of rows) {
    byDay[o.day] = (byDay[o.day] || 0) + o.total;
    byPay[o.payment_mode] = (byPay[o.payment_mode] || 0) + o.total;
    discounts += o.discount;
    if (o.type === 'kilo') { kg += o.weight || 0; caKilo += o.total; }
    else if (o.items) o.items.forEach(i => {
      const x = top[i.name] || (top[i.name] = { name: i.name, qty: 0, ca: 0 });
      x.qty += i.qty; x.ca += i.price * i.qty;
    });
  }

  // Créances en cours (avec solde calculé)
  const credits = await qAll(`SELECT o.*, COALESCE(p.t,0)::int paid_total
    FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) t FROM payments GROUP BY order_id) p ON p.order_id=o.id
    WHERE o.status!='annule' AND o.total > COALESCE(p.t,0) ORDER BY o.id`);
  for (const c of credits) { c.balance = c.total - c.paid_total; if (c.items && typeof c.items === 'string') c.items = JSON.parse(c.items); }

  const cancelled = await q1("SELECT COUNT(*)::int n, COALESCE(SUM(total),0)::int v FROM orders WHERE day BETWEEN $1 AND $2 AND status='annule'", [from, to]);

  // Encaissements sur la période
  const encaissements = await q1(`SELECT COALESCE(SUM(p.amount),0)::int total FROM payments p
    JOIN orders o ON o.id=p.order_id WHERE o.day BETWEEN $1 AND $2 AND o.status!='annule'`, [from, to]);

  res.json({
    from, to, ca, n: rows.length, avg: rows.length ? Math.round(ca / rows.length) : 0,
    kg: Math.round(kg * 100) / 100, caKilo, discounts, encaissements: encaissements.total,
    byDay: Object.entries(byDay).sort().map(([day, v]) => ({ day, v })),
    byPay, top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 10), credits, cancelled
  });
});

/* ══════════════════════════════════════════════════════════════════
   14. SAUVEGARDE (export JSON)
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/backup', auth('backup.create'), async (req, res) => {
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

/* ══════════════════════════════════════════════════════════════════
   14c. JOURNAL D'ACTIVITÉS (P2.4)
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/activity-log', auth('activity.view'), async (req, res) => {
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

/* ══════════════════════════════════════════════════════════════════
   14d. PERMISSIONS (P3.2)
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/permissions', auth('users.manage'), async (req, res) => {
  res.json({ permissions: PERMISSIONS, defaults: DEFAULT_PERMISSIONS, roles: ROLES });
});

app.put('/api/permissions', auth('users.manage'), async (req, res) => {
  const custom = req.body;
  if (!custom || typeof custom !== 'object') return fail(res, 'Données invalides');
  // Validate structure: only known roles and known permission keys
  for (const role of Object.keys(custom)) {
    if (!ROLES.includes(role)) return fail(res, `Rôle inconnu : ${role}`);
    if (typeof custom[role] !== 'object') return fail(res, `Permissions invalides pour ${role}`);
    for (const key of Object.keys(custom[role])) {
      if (!(key in DEFAULT_PERMISSIONS.gerant)) return fail(res, `Permission inconnue : ${key}`);
      if (typeof custom[role][key] !== 'boolean') return fail(res, `Valeur invalide pour ${key}`);
    }
  }
  await q("INSERT INTO settings(key,value) VALUES('permissions',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [JSON.stringify(custom)]);
  await loadPermissions();
  logActivity(req.user, 'update_permissions', 'settings', null, 'Permissions modifiées');
  res.json({ ok: true, permissions: PERMISSIONS });
});

/* ══════════════════════════════════════════════════════════════════
   15. HEALTH & SHUTDOWN
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/health', async (req, res) => {
  try { await q('SELECT 1'); res.json({ status: 'ok', time: new Date().toISOString() }); }
  catch { res.status(503).json({ status: 'db_error' }); }
});

/* ══════════════════════════════════════════════════════════════════
   16. SUIVI CLIENT (public, pas d'auth)
   ══════════════════════════════════════════════════════════════════ */
app.get('/api/track/:token', async (req, res) => {
  const token = String(req.params.token).trim();
  if (!token || token.length > 24) return fail(res, 'Lien invalide', 404);
  const o = await q1('SELECT * FROM orders WHERE track_token=$1', [token]);
  if (!o) return fail(res, 'Commande introuvable', 404);
  if (o.items && typeof o.items === 'string') o.items = JSON.parse(o.items);
  o.weight = o.weight ? Number(o.weight) : null;
  const payments = await qAll('SELECT amount,method,created_at FROM payments WHERE order_id=$1 ORDER BY id', [o.id]);
  o.paid_total = payments.reduce((s, p) => s + p.amount, 0);
  o.balance = o.total - o.paid_total;
  const history = await qAll('SELECT new_status,changed_at FROM status_history WHERE order_id=$1 ORDER BY id', [o.id]);
  // Retourner seulement les infos publiques (pas de created_by, etc.)
  const settings = await publicSettings();
  res.json({
    shop_name: settings.shop_name, shop_phone: settings.shop_phone, shop_logo: settings.invoice_logo,
    code: o.code, client_name: o.client_name, status: o.status,
    items: o.items, type: o.type, weight: o.weight, price_kg: o.price_kg, kilo_items: o.kilo_items,
    subtotal: o.subtotal, discount: o.discount, total: o.total,
    paid_total: o.paid_total, balance: o.balance, promise_date: o.promise_date,
    created_at: o.created_at, delivered_at: o.delivered_at,
    history: history.map(h => ({ status: h.new_status, at: h.changed_at }))
  });
});

app.get('/suivi/:token', (req, res) => {
  try {
    const html = fs.readFileSync(path.join(PWA_DIR, 'suivi.html'), 'utf8');
    res.type('html').send(html);
  } catch {
    try {
      const html = fs.readFileSync(path.resolve('public', 'suivi.html'), 'utf8');
      res.type('html').send(html);
    } catch { res.status(404).send('Page non trouvée'); }
  }
});

/* ── PWA static files (served from memory — sendFile/express.static broken on Vercel) ── */
const PWA_DIR = path.join(__dirname, 'public');
const PWA_FILES = {};
try {
  PWA_FILES.manifest = fs.readFileSync(path.join(PWA_DIR, 'manifest.json'), 'utf8');
  PWA_FILES.sw = fs.readFileSync(path.join(PWA_DIR, 'sw.js'), 'utf8');
  PWA_FILES.offline = fs.readFileSync(path.join(PWA_DIR, 'offline.html'), 'utf8');
  console.log('[PWA] Static files loaded into memory OK');
} catch (e) {
  console.error('[PWA] Failed to load static files from', PWA_DIR, e.message);
  // Try alternative path resolution for Vercel
  try {
    const ALT_DIR = path.resolve('public');
    PWA_FILES.manifest = fs.readFileSync(path.join(ALT_DIR, 'manifest.json'), 'utf8');
    PWA_FILES.sw = fs.readFileSync(path.join(ALT_DIR, 'sw.js'), 'utf8');
    PWA_FILES.offline = fs.readFileSync(path.join(ALT_DIR, 'offline.html'), 'utf8');
    console.log('[PWA] Static files loaded from alt path', ALT_DIR);
  } catch (e2) {
    console.error('[PWA] Alt path also failed:', e2.message);
  }
}

app.get('/manifest.json', (_req, res) => {
  if (!PWA_FILES.manifest) return res.status(404).end();
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(PWA_FILES.manifest);
});
app.get('/sw.js', (_req, res) => {
  if (!PWA_FILES.sw) return res.status(404).end();
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(PWA_FILES.sw);
});
app.get('/offline.html', (_req, res) => {
  if (!PWA_FILES.offline) return res.status(404).end();
  res.setHeader('Content-Type', 'text/html');
  res.send(PWA_FILES.offline);
});
app.get('/icons/:file', (req, res) => {
  const filePath = path.join(PWA_DIR, 'icons', req.params.file);
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(req.params.file).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  } catch { res.status(404).end(); }
});

// SPA fallback — serve index.html from memory
let INDEX_HTML;
try {
  INDEX_HTML = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
} catch {
  try { INDEX_HTML = fs.readFileSync(path.resolve('public', 'index.html'), 'utf8'); }
  catch { console.error('[SPA] Could not load index.html'); }
}
app.get('*', (req, res) => {
  if (!INDEX_HTML) return res.status(500).send('Application unavailable');
  res.type('html').send(INDEX_HTML);
});

app.use((err, req, res, next) => { console.error(err); fail(res, 'Erreur serveur', 500); });

/* ── Arrêt propre ── */
let server;
function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt propre…`);
  if (server) server.close(() => {
    pool.end().then(() => { console.log('Connexions fermées.'); process.exit(0); });
  });
  setTimeout(() => { console.error('Arrêt forcé.'); process.exit(1); }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/* ── Démarrage ── */
async function start() {
  try {
    await initDB();
    console.log('Base de données initialisée.');
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\nLight Pressing v2 démarré : http://localhost:${PORT}`);
      for (const l of Object.values(os.networkInterfaces()).flat())
        if (l && l.family === 'IPv4' && !l.internal) console.log(`Réseau local         : http://${l.address}:${PORT}`);
      console.log();
    });
  } catch (e) { console.error('Impossible de démarrer :', e.message); process.exit(1); }
}

// Vercel : exporter l'app ; sinon : démarrer le serveur
if (process.env.VERCEL) { module.exports = app; }
else start();