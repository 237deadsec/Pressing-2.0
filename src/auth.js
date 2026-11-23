'use strict';

const crypto = require('crypto');
const { SESSION_SECRET } = require('./config');

// ── Scrypt helpers ──────────────────────────────────────────────
const scryptAsync = (pw, salt, len) =>
  new Promise((ok, ko) =>
    crypto.scrypt(pw, salt, len, (e, k) => (e ? ko(e) : ok(k))));

async function hashPwd(p) {
  const s = crypto.randomBytes(16).toString('hex');
  const k = await scryptAsync(p, s, 64);
  return s + ':' + k.toString('hex');
}

async function checkPwd(p, h) {
  const [s, k] = String(h).split(':');
  if (!s || !k) return false;
  const a = Buffer.from(k, 'hex');
  const b = await scryptAsync(p, s, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── HMAC token (HttpOnly cookie pp_session, 12 h) ──────────────
const sign = (d) =>
  crypto.createHmac('sha256', SESSION_SECRET).update(d).digest('base64url');

const makeToken = (u) => {
  const p = Buffer.from(
    JSON.stringify({ id: u.id, exp: Date.now() + 12 * 3600e3 })
  ).toString('base64url');
  return p + '.' + sign(p);
};

const readToken = (t) => {
  if (!t) return null;
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  const a = Buffer.from(sign(p));
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
};

module.exports = { hashPwd, checkPwd, makeToken, readToken };
