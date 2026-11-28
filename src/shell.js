'use strict';
/* ══════════════════════════════════════════════════════════════════
   Coquille de l'application (index.html + app.js), servie depuis la mémoire.

   Pourquoi : sur Vercel tous les fichiers ont la même date (20/10/2018), donc
   l'ETag d'express.static (taille + date) ne change presque pas d'un déploiement
   à l'autre, et l'ancien service worker (pp-v1, cache-first) continuait à servir
   l'ancien app.js. Résultat : une correction déployée n'arrivait pas dans le
   navigateur du pressing.

   Ici :
   • APP_VERSION = empreinte du contenu de index.html + app.js + sw.js ;
   • index.html charge /app.js?v=APP_VERSION : une nouvelle version = une nouvelle
     URL, qu'aucun cache (navigateur ou ancien service worker) ne connaît ;
   • index.html n'est jamais mis en cache (no-cache) ;
   • /api/version permet à une page restée ouverte de savoir qu'elle est périmée.
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

function readPublic(name) {
  for (const dir of [path.join(__dirname, '..', 'public'), path.resolve('public')]) {
    try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* essai suivant */ }
  }
  console.error('[shell] fichier introuvable :', name);
  return null;
}

const RAW_INDEX = readPublic('index.html');
const APP_JS = readPublic('app.js');
const SW_JS = readPublic('sw.js') || '';

const APP_VERSION = crypto.createHash('sha256')
  .update(RAW_INDEX || '').update('\0').update(APP_JS || '').update('\0').update(SW_JS)
  .digest('hex').slice(0, 12);

const SCRIPT_TAG = '<script src="/app.js"></script>';
if (RAW_INDEX && !RAW_INDEX.includes(SCRIPT_TAG)) console.error('[shell] balise app.js introuvable dans index.html');
const INDEX_HTML = RAW_INDEX && RAW_INDEX.replace(
  SCRIPT_TAG,
  `<script>window.APP_VERSION=${JSON.stringify(APP_VERSION)};</script>\n<script src="/app.js?v=${APP_VERSION}"></script>`
);

function sendIndex(_req, res) {
  if (!INDEX_HTML) return res.status(500).send('Application unavailable');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
}

const router = express.Router();
router.get(['/', '/index.html'], sendIndex);
router.get('/app.js', (req, res) => {
  if (!APP_JS) return res.status(404).end();
  // URL versionnée : contenu immuable. URL nue (anciennes pages) : toujours revalider.
  res.setHeader('Cache-Control', req.query.v === APP_VERSION ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.type('application/javascript').send(APP_JS);
});
router.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: APP_VERSION });
});

module.exports = { router, sendIndex, APP_VERSION };
