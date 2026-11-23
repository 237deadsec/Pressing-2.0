'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ══════════════════════════════════════════════════════════════════
   MODULES
   ══════════════════════════════════════════════════════════════════ */
const { PORT, fail } = require('./src/config');
const { pool, initDB } = require('./src/db');
const { loadPermissions } = require('./src/helpers');

/* ── Route modules ── */
const authRouter          = require('./src/routes/auth');
const statsRouter         = require('./src/routes/stats');
const catalogRouter       = require('./src/routes/catalog');
const settingsRouter      = require('./src/routes/settings');
const usersRouter         = require('./src/routes/users');
const clientsRouter       = require('./src/routes/clients');
const ordersRouter        = require('./src/routes/orders');
const paymentsRouter      = require('./src/routes/payments');
const subscriptionsRouter = require('./src/routes/subscriptions');
const creancesRouter      = require('./src/routes/creances');
const permissionsRouter   = require('./src/routes/permissions');
const activityLogRouter   = require('./src/routes/activity-log');
const backupRouter        = require('./src/routes/backup');
const healthRouter        = require('./src/routes/health');
const trackingRouter      = require('./src/routes/tracking');

/* ══════════════════════════════════════════════════════════════════
   EXPRESS APP
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

/* ══════════════════════════════════════════════════════════════════
   ROUTE MOUNTS
   ══════════════════════════════════════════════════════════════════ */
app.use('/api', authRouter);                        // /login, /logout, /bootstrap, /password
app.use('/api', statsRouter);                       // /stats, /late-orders, /reports
app.use('/api/catalog', catalogRouter);             // /, /:id, /:id/price-history
app.use('/api/settings', settingsRouter);           // /, /logo
app.use('/api/users', usersRouter);                 // /, /:id
app.use('/api/clients', clientsRouter);             // /, /search, /:id, /:id/subscriptions
app.use('/api/orders', ordersRouter);               // /, /:id, /:id/status
app.use('/api/orders', paymentsRouter);             // /:id/pay, /:id/payments
app.use('/api/subscriptions', subscriptionsRouter); // /, /:id, /:id/use
app.use('/api/creances', creancesRouter);           // /
app.use('/api/permissions', permissionsRouter);     // / (GET, PUT)
app.use('/api/activity-log', activityLogRouter);    // /
app.use('/api/backup', backupRouter);               // /
app.use('/api/health', healthRouter);               // /
app.use('/api/track', trackingRouter);              // /:token

/* ══════════════════════════════════════════════════════════════════
   HTML / PWA / SPA ROUTES
   ══════════════════════════════════════════════════════════════════ */

/* ── Suivi public page ── */
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
