'use strict';
// Parcours complets dans l'interface, comme à la caisse.
const { test, expect } = require('@playwright/test');
const { loginAs, api, visiblePages, INITIAL, NEW_PWD } = require('./helpers');

test.describe.configure({ mode: 'serial' });

let errors;
test.beforeEach(async ({ page, context }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '1' : undefined));
  await context.addInitScript(() => { window.print = () => {}; });
});
test.afterEach(() => {
  expect(errors, 'erreurs JavaScript dans la page').toEqual([]);
});

const nav = (page, id) => page.click(`#nav button[data-page="${id}"]`);
const modal = (page) => page.locator('#generic-modal.open #generic-modal-body');

test('connexion par le formulaire avec changement du mot de passe initial', async ({ page }) => {
  await page.goto('/');
  await page.fill('#l-user', 'superviseur');
  await page.fill('#l-pwd', INITIAL.superviseur);
  await page.click('#l-btn');
  await expect(page.locator('#chpwd-modal')).toHaveClass(/open/);
  await page.fill('#ch-cur', INITIAL.superviseur);
  await page.fill('#ch-new', NEW_PWD('superviseur'));
  await page.fill('#ch-conf', NEW_PWD('superviseur'));
  await page.locator('#chpwd-modal button', { hasText: /Changer|Valider|Enregistrer/ }).first().click();
  await expect(page.locator('#app')).toBeVisible();
  expect(await visiblePages(page)).toEqual(['p-dashboard']);
  await page.click('text=Déconnexion');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#l-user', 'superviseur');
  await page.fill('#l-pwd', 'mauvais');
  await page.click('#l-btn');
  await expect(page.locator('#login-error')).toBeVisible();
});

test('commande par article : création, statuts jusqu\'à la livraison, facture', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'neworder');
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#catalog-grid button').nth(1).click();
  await expect(page.locator('#cart-body tr')).toHaveCount(2);
  await page.fill('#o-client', 'Awa Mballa');
  await page.fill('#o-phone', '+237 690 11 22 33');
  await page.selectOption('#o-payment', 'Espèces');
  await page.click('#submit-order-btn');
  await expect(modal(page)).toContainText('Awa Mballa');
  await expect(modal(page).locator('a[href^="https://wa.me/237690112233?"]')).toHaveCount(1);
  await page.evaluate(() => closeModal());
  await expect(page.locator('#cart-section')).toBeHidden();

  await nav(page, 'orders');
  await page.locator('#orders-body tr', { hasText: 'Awa Mballa' }).first().click();
  await expect.poll(() => visiblePages(page)).toEqual(['p-order-detail']);
  for (const [btn, label] of [['▶ Traitement', 'En traitement'], ['✅ Prêt', 'Prêt'], ['📦 Livrer', 'Livré']]) {
    await page.getByRole('button', { name: btn }).click();
    await expect(page.locator('#order-detail-content .badge').first()).toContainText(label);
  }
  await page.getByRole('button', { name: /Facture/ }).click();
  await expect(modal(page)).toContainText('Facture');
  await page.evaluate(() => closeModal());
});

test('commande à crédit avec acompte, puis encaissement du solde', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'neworder');
  await page.locator('#catalog-grid button').first().click();
  await page.fill('#o-client', 'Client Crédit');
  await page.fill('#o-phone', '691000000');
  await page.selectOption('#o-payment', 'Crédit');
  await expect(page.locator('#acompte-section')).toBeVisible();
  await page.fill('#o-acompte', '100');
  await page.click('#submit-order-btn');
  await expect(modal(page)).toContainText('Client Crédit');
  await page.evaluate(() => closeModal());

  await nav(page, 'creances');
  await expect(page.locator('#creances-body')).toContainText('Client Crédit');
  await nav(page, 'orders');
  await page.locator('#orders-body tr', { hasText: 'Client Crédit' }).first().click();
  await page.getByRole('button', { name: /Encaisser/ }).click();
  await modal(page).getByRole('button', { name: /Encaisser|Valider|Confirmer/ }).last().click();
  await expect(page.locator('#order-detail-content')).toContainText('Soldé');
});

test('commande au kilo et modification d\'une commande déposée', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'neworder');
  await page.evaluate(() => setOrderType('kilo'));
  await page.fill('#o-weight', '2.5');
  await page.fill('#o-kitems', '3 chemises, 1 drap');
  await page.fill('#o-client', 'Client Kilo');
  await page.click('#submit-order-btn');
  await expect(modal(page)).toContainText('3 chemises');
  await page.evaluate(() => closeModal());

  // Ouverture d'une fenêtre juste après en avoir fermé une : elle doit rester ouverte.
  const cat = await page.evaluate(() => CAT[0].id);
  const o = await api(page, 'POST', '/api/orders', { client: 'Client Édition', payment: 'Espèces', type: 'article', items: [{ id: cat, qty: 1 }] });
  await page.evaluate((id) => showOrder(id), o.id);
  await page.getByRole('button', { name: /Éditer/ }).click();
  await expect(modal(page)).toContainText('Modifier la commande');
  await modal(page).locator('summary', { hasText: 'Ajouter un article' }).click();
  await modal(page).locator('details button').nth(1).click();
  await expect(page.locator('#edit-cart-list tbody tr')).toHaveCount(2);
  await modal(page).getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.locator('#generic-modal')).not.toHaveClass(/open/);
  const after = await api(page, 'GET', `/api/orders/${o.id}`);
  expect(after.items.length).toBe(2);
});

test('clients : création et modification', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'clients');
  await page.click('#btn-add-client');
  await page.fill('#nc-name', 'Nouvelle Cliente');
  await page.fill('#nc-phone', '677000111');
  await modal(page).getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.locator('#clients-body')).toContainText('Nouvelle Cliente');
  await page.locator('#clients-body tr', { hasText: 'Nouvelle Cliente' }).locator('button').click();
  await page.fill('#edit-cl-name', 'Nouvelle Cliente Modifiée');
  await modal(page).getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.locator('#client-detail-title')).toContainText('Modifiée');
  await page.locator('#client-detail-card button', { hasText: /Retour/ }).click();
  await expect(page.locator('#clients-list-card')).toBeVisible();
});

test('catalogue : ajout, changement de prix et historique', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'catalog');
  await page.locator('#p-catalog button', { hasText: /Ajouter|Nouvel/ }).first().click();
  await page.fill('#cat-name', 'Rideau test');
  await page.fill('#cat-price', '3000');
  await modal(page).getByRole('button', { name: 'Enregistrer' }).click();
  const row = page.locator('#catalog-body tr', { hasText: 'Rideau test' });
  await expect(row).toHaveCount(1);
  await row.locator('button').first().click();
  await page.fill('#cat-price', '3500');
  await modal(page).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(row).toContainText('3');
  await row.locator('button[title="Historique prix"]').click();
  await expect(modal(page)).toContainText('3');
  await page.evaluate(() => closeModal());
});

test('abonnements : création et utilisation', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'subscriptions');
  await page.locator('#p-subscriptions button', { hasText: /Nouvel|Ajouter/ }).first().click();
  await expect(page.locator('#sub-client option')).not.toHaveCount(1);
  await page.selectOption('#sub-client', { index: 1 });
  await page.fill('#sub-plan', 'Formule 20');
  await page.fill('#sub-total', '20');
  await page.fill('#sub-paid', '10000');
  await modal(page).getByRole('button', { name: /Créer|Enregistrer/ }).click();
  const row = page.locator('#subs-body tr', { hasText: 'Formule 20' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Utiliser' }).click();
  await expect(row).toContainText('1/20');
});

test('utilisateurs, paramètres, rapports et journal', async ({ page }) => {
  await loginAs(page, 'gerant');
  await nav(page, 'users');
  await page.locator('#p-users button', { hasText: /Nouvel|Ajouter/ }).first().click();
  await page.fill('#u-login', 'caisse2');
  await page.fill('#u-name', 'Caisse Deux');
  await page.fill('#u-pwd', 'caisse2-pass');
  await modal(page).getByRole('button', { name: /Enregistrer|Créer/ }).click();
  await expect(page.locator('#users-body')).toContainText('Caisse Deux');

  await nav(page, 'settings');
  await expect(page.locator('#s-name')).not.toHaveValue('');
  await page.fill('#s-addr', 'Kribi, Cameroun');
  await page.locator('#p-settings button', { hasText: /Enregistrer/ }).first().click();
  await page.reload();
  await nav(page, 'settings');
  await expect(page.locator('#s-addr')).toHaveValue('Kribi, Cameroun');

  await nav(page, 'reports');
  await expect(page.locator('#report-content')).toContainText(/CA|Commandes/);
  const dl = page.waitForEvent('download');
  await page.click('text=CSV');
  expect((await dl).suggestedFilename()).toMatch(/^rapport_.*\.csv$/);

  await nav(page, 'activity');
  await expect(page.locator('#p-activity')).toContainText(/create_order|Commande|commande/);
  await nav(page, 'dashboard');
  await expect(page.locator('#dash-stats')).not.toBeEmpty();
});

test('caissier : menus limités à ses droits, peut encaisser une commande', async ({ page }) => {
  await loginAs(page, 'caissier');
  const ids = await page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.page));
  expect(ids).toContain('neworder');
  for (const forbidden of ['settings', 'users', 'catalog', 'activity']) expect(ids).not.toContain(forbidden);
  const r = await page.request.put('/api/settings', { data: { shop_name: 'x', kilo_price: 1, default_delay: 1, max_discount_percent: 1 } });
  expect(r.status()).toBe(403);
  await nav(page, 'neworder');
  await page.locator('#catalog-grid button').first().click();
  await page.fill('#o-client', 'Client Caisse');
  await page.click('#submit-order-btn');
  await expect(modal(page)).toContainText('Client Caisse');
});
