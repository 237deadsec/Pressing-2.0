'use strict';
// Bug signalé : du « script » s'affichait sur certaines commandes. Toute donnée
// saisie (client, téléphone, article, notes, paramètres...) doit s'afficher comme
// du texte, jamais être interprétée comme du HTML ou du JavaScript.
const { test, expect } = require('@playwright/test');
const { loginAs, api } = require('./helpers');

// Charge utile qui sort des attributs ("), des chaînes JS (') et des balises (>).
const P = (tag) => `${tag}"'><img src=x onerror="window.__xss='${tag}'"><script>window.__xss='${tag}-s'</script>`;
// Variante courte pour les champs limités à 40 caractères (téléphones).
const SHORT = `6"'><img src=x onerror=__xss=1>`;

const seen = [];
async function check(page, label) {
  await page.waitForTimeout(400);
  const xss = await page.evaluate(() => window.__xss);
  const injected = await page.locator('img[src="x"], script').evaluateAll(
    (els) => els.filter((e) => e.tagName === 'IMG' || e.textContent.includes('__xss')).length);
  expect(xss, `${label} : code injecté exécuté`).toBeUndefined();
  expect(injected, `${label} : balise injectée dans la page`).toBe(0);
  seen.push(label);
}

test.describe.configure({ mode: 'serial' });

test('les données saisies ne sont jamais exécutées (application + page de suivi)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await context.addInitScript(() => { window.print = () => {}; window.open = () => ({ document: { write() {}, close() {} }, print() {} }); });
  await loginAs(page, 'gerant');

  // ── Données piégées dans tous les champs texte ──
  const settings = await api(page, 'PUT', '/api/settings', {
    shop_name: P('shop'), shop_address: P('addr'), shop_phone: SHORT, shop_niu: SHORT,
    kilo_price: 1000, default_delay: 2, max_discount_percent: 50, invoice_format: 'A6',
    invoice_header: P('hdr'), invoice_footer: P('ftr'),
  });
  expect(settings.shop_name).toContain('shop"');
  await api(page, 'POST', '/api/catalog', { name: P('cat'), price: 1500, price_express: 2500, icon: '<b>', category: P('categ') });
  const catalog = await api(page, 'GET', '/api/catalog');
  const evilItem = catalog.find((c) => c.name.startsWith('cat"'));
  const plainItem = catalog.find((c) => !c.name.startsWith('cat"'));
  await api(page, 'POST', '/api/clients', { name: P('cli'), phone: SHORT, email: P('mail'), address: P('cadr'), notes: P('cnote') });
  const o1 = await api(page, 'POST', '/api/orders', {
    client: P('ocli'), phone: SHORT, payment: 'Crédit', type: 'article',
    items: [{ id: evilItem.id, qty: 2 }], discount: 100, discount_reason: P('disc'),
  });
  const o2 = await api(page, 'POST', '/api/orders', { client: P('kcli'), phone: SHORT, payment: 'Espèces', type: 'kilo', weight: 3, kilo_items: P('kitems') });
  await api(page, 'PUT', `/api/orders/${o2.id}/status`, { status: 'traitement', note: P('note') });
  const o3 = await api(page, 'POST', '/api/orders', { client: P('xcli'), phone: SHORT, payment: 'Espèces', type: 'article', items: [{ id: plainItem.id, qty: 1 }] });
  await api(page, 'PUT', `/api/orders/${o3.id}/status`, { status: 'annule', note: P('cancel') });
  await api(page, 'POST', '/api/users', { username: 'piege', name: P('uname'), role: 'caissier', password: 'piege-12345' });
  const clients = await api(page, 'GET', '/api/clients');
  const evilClient = clients.find((c) => c.name.startsWith('cli"'));
  const sub = await api(page, 'POST', '/api/subscriptions', { client_id: evilClient.id, plan_name: P('plan'), total_articles: 10, amount_paid: 1000, notes: P('subn') });

  // ── Tous les écrans ──
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await check(page, 'démarrage');
  const ids = await page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.page));
  for (const id of ids) {
    await page.click(`#nav button[data-page="${id}"]`);
    await check(page, `onglet ${id}`);
  }
  // Le nom piégé est affiché tel quel, comme du texte.
  await page.click('#nav button[data-page="orders"]');
  await expect(page.locator('#orders-body')).toContainText(`ocli"'><img src=x`);

  for (const o of [o1, o2, o3]) {
    await page.evaluate((id) => showOrder(id), o.id);
    await check(page, `détail commande ${o.code}`);
    await page.evaluate((id) => printOrder(id, 'depot'), o.id);
    await check(page, `bon ${o.code}`);
    await page.evaluate(() => closeModal());
  }
  // Lien WhatsApp : le numéro ne garde que des chiffres.
  await page.evaluate((id) => showOrder(id), o1.id);
  const wa = await page.locator('#order-detail-content a[href^="https://wa.me/"]').getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/\d*\?text=/);

  // Édition d'une commande déposée + ajout de l'article piégé.
  await page.evaluate((id) => showEditOrderModal(id), o1.id);
  await check(page, 'édition commande');
  await page.locator('.modal summary', { hasText: 'Ajouter un article' }).click();
  await page.locator('.modal button', { hasText: 'cat"' }).click();
  await check(page, 'ajout article piégé');
  await expect(page.locator('#edit-cart-list')).toContainText('cat"');
  await page.evaluate(() => closeModal());

  await page.evaluate(() => showPayModal(1, 100));
  await check(page, 'encaissement');
  await page.evaluate(() => closeModal());

  await page.click('#nav button[data-page="clients"]');
  await page.evaluate((id) => showClientDetail(id), evilClient.id);
  await check(page, 'fiche client');

  await page.click('#nav button[data-page="catalog"]');
  await page.evaluate((id) => showPriceHistory(id), evilItem.id);
  await check(page, 'historique prix');
  await page.evaluate(() => closeModal());
  await page.evaluate((id) => editCatalogItem(id), evilItem.id).catch(() => {});
  await check(page, 'modification article');
  await page.evaluate(() => closeModal());

  await page.click('#nav button[data-page="users"]');
  await page.evaluate(() => showUserModal(USERS_LIST.find((u) => u.username === 'piege')));
  await check(page, 'modification utilisateur');
  await page.evaluate(() => closeModal());

  await page.click('#nav button[data-page="subscriptions"]');
  await page.evaluate((id) => showSubModal(id), sub.id);
  await check(page, 'modification abonnement');
  await page.evaluate(() => closeModal());

  await page.click('#nav button[data-page="reports"]');
  await page.evaluate(() => loadReports());
  await check(page, 'rapport');

  await page.click('#nav button[data-page="neworder"]');
  await page.fill('#o-client', 'cli');
  await page.locator('#o-client').dispatchEvent('input');
  await page.waitForTimeout(800);
  await check(page, 'suggestions client');

  // ── Page publique de suivi ──
  for (const o of [o1, o2, o3]) {
    const full = await api(page, 'GET', `/api/orders/${o.id}`);
    const p2 = await context.newPage();
    await p2.goto(`/suivi/${full.track_token}`);
    await expect(p2.locator('#root')).toContainText(full.code);
    await check(p2, `suivi ${full.code}`);
    const shopWa = await p2.locator('a[href^="https://wa.me/"]').getAttribute('href');
    expect(shopWa).toMatch(/^https:\/\/wa\.me\/\d*$/);
    await p2.close();
  }

  expect(dialogs, 'aucune boîte de dialogue ouverte par une donnée').toEqual([]);
  expect(seen.length).toBeGreaterThan(20);

  // Remet un nom de boutique propre pour les autres tests.
  await api(page, 'PUT', '/api/settings', {
    shop_name: 'Light Pressing', shop_address: 'Kribi', shop_phone: '+237 690 00 00 00', shop_niu: '',
    kilo_price: 1000, default_delay: 2, max_discount_percent: 50, invoice_format: 'A6', invoice_header: '', invoice_footer: '',
  });
});
