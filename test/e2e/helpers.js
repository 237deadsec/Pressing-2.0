'use strict';
const { expect } = require('@playwright/test');

// Comptes créés par le serveur sur une base vierge (hors production).
const INITIAL = { gerant: '0000', superviseur: '2345', caissier: '1234' };
const NEW_PWD = (u) => `${u}-E2e-2026`;

// Ouvre une session via l'API (le cookie est partagé avec la page) en
// changeant le mot de passe initial si le serveur l'exige.
async function loginAs(page, username) {
  const req = page.request;
  let r = await req.post('/api/login', { data: { username, password: NEW_PWD(username) } });
  if (!r.ok()) {
    r = await req.post('/api/login', { data: { username, password: INITIAL[username] } });
    expect(r.ok(), `login ${username}`).toBeTruthy();
    const body = await r.json();
    if (body.user && body.user.must_change) {
      const c = await req.post('/api/password', { data: { current: INITIAL[username], password: NEW_PWD(username) } });
      expect(c.ok(), 'changement de mot de passe').toBeTruthy();
    }
  }
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
}

async function api(page, method, path, data) {
  const r = await page.request.fetch(path, { method, data });
  const body = await r.json().catch(() => ({}));
  expect(r.ok(), `${method} ${path} → ${r.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

// Identifiants des vues (.page) réellement affichées.
async function visiblePages(page) {
  return page.$$eval('.page', (ps) => ps.filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.id));
}

module.exports = { loginAs, api, visiblePages, INITIAL, NEW_PWD };
