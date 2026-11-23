'use strict';

const crypto = require('crypto');

/* ── Constants ── */
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const ROLES = ['caissier', 'superviseur', 'gerant'];
const STATUSES = ['depose', 'traitement', 'pret', 'livre', 'annule'];
const PAYMENT_MODES = ['Espèces', 'Mobile Money', 'Crédit'];
const PAYMENT_METHODS = ['Espèces', 'Mobile Money'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TRANSITIONS = {
  depose: ['traitement'], traitement: ['pret'], pret: ['livre'], livre: [], annule: []
};
const CANCELLABLE = ['depose', 'traitement', 'pret'];

/* ── Utility functions ── */
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fail = (res, m, c = 400) => res.status(c).json({ error: m });

/* ── Permissions ── */
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
    'subscriptions.view': true, 'subscriptions.manage': false, 'subscriptions.use': true,
    'stats.view': true, 'reports.view': true, 'reports.export': false,
    'creances.view': true, 'settings.manage': false,
    'users.manage': false, 'activity.view': true, 'backup.create': false
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

// Mutable runtime permissions (loaded from DB)
let PERMISSIONS = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));

function hasPermission(role, perm) {
  return !!(PERMISSIONS[role] && PERMISSIONS[role][perm]);
}

function getPermissions() { return PERMISSIONS; }
function getDefaultPermissions() { return DEFAULT_PERMISSIONS; }

// Called by helpers.loadPermissions after DB is ready
function applyCustomPermissions(custom) {
  for (const role of ROLES) {
    PERMISSIONS[role] = { ...DEFAULT_PERMISSIONS[role], ...(custom[role] || {}) };
  }
}

function resetPermissions() {
  PERMISSIONS = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
}

module.exports = {
  PORT, SESSION_SECRET,
  ROLES, STATUSES, PAYMENT_MODES, PAYMENT_METHODS, DATE_RE,
  TRANSITIONS, CANCELLABLE,
  pad, localDate, fail,
  DEFAULT_PERMISSIONS,
  hasPermission, getPermissions, getDefaultPermissions,
  applyCustomPermissions, resetPermissions
};
