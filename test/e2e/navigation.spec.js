'use strict';
// Bug signalé : en passant d'un onglet à l'autre, les vues précédentes restaient
// affichées et s'empilaient. Chaque vue doit remplacer la précédente.
const { test, expect } = require('@playwright/test');
const { loginAs, visiblePages } = require('./helpers');

test('chaque onglet remplace le précédent (gérant)', async ({ page }) => {
  await loginAs(page, 'gerant');
  const ids = await page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.page));
  expect(ids.length).toBeGreaterThan(5);
  // Aller-retour complet, puis dans l'autre sens.
  for (const id of [...ids, ...[...ids].reverse()]) {
    await page.click(`#nav button[data-page="${id}"]`);
    await expect.poll(() => visiblePages(page)).toEqual([`p-${id}`]);
    await expect(page.locator(`#nav button[data-page="${id}"]`)).toHaveClass(/active/);
    await expect(page.locator('#nav button.active')).toHaveCount(1);
  }
});

test('le détail d\'une commande remplace la liste, et « Retour » revient', async ({ page }) => {
  await loginAs(page, 'gerant');
  const cat = await page.evaluate(() => CAT[0].id);
  const r = await page.request.post('/api/orders', { data: { client: 'Nav Test', phone: '690000001', payment: 'Espèces', type: 'article', items: [{ id: cat, qty: 1 }] } });
  expect(r.ok()).toBeTruthy();
  await page.click('#nav button[data-page="orders"]');
  await page.locator('#orders-body tr', { hasText: 'Nav Test' }).first().click();
  await expect.poll(() => visiblePages(page)).toEqual(['p-order-detail']);
  await page.getByRole('button', { name: '← Retour' }).click();
  await expect.poll(() => visiblePages(page)).toEqual(['p-orders']);
  await page.click('#nav button[data-page="dashboard"]');
  await expect.poll(() => visiblePages(page)).toEqual(['p-dashboard']);
});

test('sur mobile, le menu se referme et une seule vue reste affichée', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await loginAs(page, 'caissier');
  const ids = await page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.page));
  for (const id of ids) {
    await page.evaluate(() => toggleSidebar());
    await page.click(`#nav button[data-page="${id}"]`);
    await expect.poll(() => visiblePages(page)).toEqual([`p-${id}`]);
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  }
  await ctx.close();
});
