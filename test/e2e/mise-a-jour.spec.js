'use strict';
// Bug signalé après la PR #7 : la correction était bien en production, mais le
// navigateur du pressing continuait d'exécuter l'ancien app.js (onglets empilés).
// Cause : l'ancien service worker (pp-v1, cache-first) servait l'app.js mis en
// cache, et une page restée ouverte ne recharge jamais le code.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAs, visiblePages } = require('./helpers');

// Service worker tel qu'il était en production avant la PR #7.
const OLD_SW = fs.readFileSync(path.join(__dirname, 'fixtures', 'sw-pp-v1.js'), 'utf8');

test('après un déploiement, un navigateur qui avait l\'ancien service worker exécute le nouveau code dès le rechargement', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ctx.route('**/sw.js', (r) => r.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-cache' }, body: OLD_SW }));

  await loginAs(page, 'gerant');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // L'ancien service worker a en cache un app.js périmé (l'ancienne version).
  await page.evaluate(async () => {
    const c = await caches.open('static-pp-v1');
    await c.put('/app.js', new Response('window.__STALE_APP = true;', { headers: { 'Content-Type': 'application/javascript' } }));
  });
  // Contrôle du scénario : sans versionnement, c'est bien ce fichier périmé qui serait servi.
  expect(await page.evaluate(() => fetch('/app.js').then((r) => r.text()))).toContain('__STALE_APP');

  // « Déploiement » : le serveur sert désormais le service worker actuel.
  await ctx.unroute('**/sw.js');
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => window.__STALE_APP)).toBeUndefined();

  // Et la navigation est bien celle du nouveau code : une seule vue à la fois.
  for (const id of ['neworder', 'orders', 'clients', 'dashboard']) {
    await page.click(`#nav button[data-page="${id}"]`);
    await expect.poll(() => visiblePages(page)).toEqual([`p-${id}`]);
  }
  await ctx.close();
});

test('index.html n\'est jamais mis en cache et charge app.js à l\'URL de la version servie', async ({ page }) => {
  const res = await page.request.get('/');
  expect(res.headers()['cache-control']).toBe('no-cache');
  const { version } = await (await page.request.get('/api/version')).json();
  expect(version).toMatch(/^[0-9a-f]{12}$/);
  expect(await res.text()).toContain(`<script src="/app.js?v=${version}"></script>`);
  const js = await page.request.get(`/app.js?v=${version}`);
  expect(js.headers()['cache-control']).toContain('immutable');
  const bare = await page.request.get('/app.js');
  expect(bare.headers()['cache-control']).toBe('no-cache');
});

test('une page restée ouverte se met à jour au retour sur l\'appli, sauf en pleine saisie', async ({ page }) => {
  await loginAs(page, 'gerant');
  const { version } = await (await page.request.get('/api/version')).json();
  const resume = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  // En pleine saisie d'une commande : pas de rechargement, un bandeau.
  await page.click('#nav button[data-page="neworder"]');
  await page.evaluate(() => { window.APP_VERSION = 'ancienne'; window.__notReloaded = true; });
  await resume();
  await expect(page.locator('#update-banner')).toBeVisible();
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);

  // Ailleurs : rechargement automatique sur la nouvelle version.
  await page.click('#nav button[data-page="dashboard"]');
  await Promise.all([page.waitForEvent('load'), resume()]);
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => window.APP_VERSION)).toBe(version);
  expect(await page.evaluate(() => window.__notReloaded)).toBeUndefined();
});
