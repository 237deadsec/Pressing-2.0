'use strict';

const express = require('express');

// Express 4 n'intercepte pas les promesses rejetées des handlers `async` :
// une erreur SQL dans une route devenait un rejet non géré, et Node (>= 15)
// arrêtait tout le processus. Ce Router enveloppe chaque handler pour
// transmettre l'erreur à next(), donc au gestionnaire d'erreurs de server.js
// (réponse 500 JSON), sans toucher au reste du serveur.
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length === 4) return fn; // middleware d'erreur : inchangé
  return function wrapped(req, res, next) {
    let r;
    try { r = fn(req, res, next); } catch (e) { return next(e); }
    if (r && typeof r.then === 'function') r.catch(next);
    return r;
  };
}

const wrapAll = (handlers) => handlers.map((h) => (Array.isArray(h) ? wrapAll(h) : wrap(h)));

function Router(opts) {
  const router = express.Router(opts);
  for (const m of METHODS) {
    const orig = router[m].bind(router);
    router[m] = (path, ...handlers) => orig(path, ...wrapAll(handlers));
  }
  return router;
}

module.exports = { Router, wrap };
