/* ══════════════════════════════════════════════════════════════════════
 *  PressingPro — Application Frontend SPA
 *  ──────────────────────────────────────────────────────────────────
 *  Structure :
 *    Section 1  : Globals & Utilitaires
 *    Section 2  : Authentification
 *    Section 3  : Bootstrap & Initialisation
 *    Section 4  : Navigation & UI
 *    Section 5  : Dashboard
 *    Section 6  : Catalogue (grille commande) & Panier
 *    Section 7  : Commande — Création & Soumission
 *    Section 8  : Reçu / Facture & Impression
 *    Section 9  : Commandes — Liste & Détail
 *    Section 10 : Clients
 *    Section 11 : Catalogue — Administration CRUD
 *    Section 12 : Paramètres
 *    Section 13 : Gestion des Utilisateurs
 *    Section 14 : Rapports
 *    Section 15 : Modal & Écouteurs globaux
 * ══════════════════════════════════════════════════════════════════════ */


/* ══════ SECTION 1 : GLOBALS & UTILITAIRES ══════════════════════════ */

let U = null,
    S = {},
    CAT = [],
    CART = [],
    orderType = "article",
    currentPage = "dashboard",
    ordersPage = 1,
    $ = t => document.getElementById(t),
    $$ = t => document.querySelectorAll(t),
    fmt = t => (t || 0).toLocaleString("fr-FR") + " F",
    esc = t => String(t ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),
    api = async (t, e = {}) => {
        t = await fetch(t, {
            headers: {
                "Content-Type": "application/json"
            },
            ...e
        }), e = await t.json().catch(() => ({
            error: "Erreur réseau"
        }));
        if (t.ok) return e;
        throw new Error(e.error || "Erreur")
    };

let SEARCH_RESULTS = [], USERS_LIST = [];


/* ══════ SECTION 2 : AUTHENTIFICATION ══════════════════════════════ */

async function doLogin() {
    var e = $("l-btn");
    e.disabled = !0, e.innerHTML = '<span class="spinner"></span>';
    try {
        var t = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                username: $("l-user").value.trim(),
                password: $("l-pwd").value
            })
        });
        (U = t.user).must_change ? ($("chpwd-modal").classList.add("open"), e.disabled = !1, e.textContent = "Connexion") : await bootstrap()
    } catch (t) {
        $("login-error").style.display = "block", $("login-error").textContent = t.message, e.disabled = !1, e.textContent = "Connexion"
    }
}

async function doChangePwd() {
    var t = $("ch-new").value;
    if (t !== $("ch-conf").value) $("chpwd-error").style.display = "block", $("chpwd-error").textContent = "Les mots de passe ne correspondent pas";
    else try {
        await api("/api/password", {
            method: "POST",
            body: JSON.stringify({
                current: $("ch-cur").value,
                password: t
            })
        }), U.must_change = !1, $("chpwd-modal").classList.remove("open"), toast("Mot de passe changé", "ok"), await bootstrap()
    } catch (t) {
        $("chpwd-error").style.display = "block", $("chpwd-error").textContent = t.message
    }
}

async function doLogout() {
    await fetch("/api/logout", {
        method: "POST"
    }), location.reload()
}


/* ══════ SECTION 3 : BOOTSTRAP & INITIALISATION ═══════════════════ */

async function bootstrap() {
    try {
        var t = await api("/api/bootstrap"),
            e = (U = t.user, S = t.settings, CAT = t.catalog, $("login").style.display = "none", $("app").style.display = "block", $("shop-title").textContent = S.shop_name || "PressingPro", $("user-badge").textContent = U.name, $("role-badge").textContent = U.role.charAt(0).toUpperCase() + U.role.slice(1), document.title = S.shop_name || "PressingPro", buildNav(), renderCatalogGrid(), $("o-pkg").value = S.kilo_price, new Date);
        e.setDate(e.getDate() + (S.default_delay || 2)), $("o-promise").value = e.toISOString().slice(0, 10), $("discount-section").classList.remove("hidden");
        try {
            var a = sessionStorage.getItem("pp_cart");
            a && (CART = JSON.parse(a))
        } catch (t) {}
        renderCart(), nav("dashboard")
    } catch (t) {
        toast(t.message, "err")
    }
}

$("l-pwd").addEventListener("keydown", t => {
    "Enter" === t.key && doLogin()
});

(async () => {
    try {
        await bootstrap()
    } catch (t) {}
})();


/* ══════ SECTION 4 : NAVIGATION & UI ══════════════════════════════ */

/* NOTE: Le frontend utilise "caisse" et "gerant" comme identifiants de rôle.
   Le backend (server.js) utilise "caissier", "superviseur", "gerant".
   ⚠️ MISMATCH CONNU — le rôle "superviseur" n'est pas représenté ici. */

let PAGES = [{
    id: "dashboard",
    icon: "📊",
    label: "Tableau de bord",
    roles: ["caisse", "gerant"]
}, {
    id: "neworder",
    icon: "🧾",
    label: "Nouvelle commande",
    roles: ["caisse", "gerant"]
}, {
    id: "orders",
    icon: "📋",
    label: "Commandes",
    roles: ["caisse", "gerant"]
}, {
    id: "clients",
    icon: "👥",
    label: "Clients",
    roles: ["caisse", "gerant"]
}, {
    id: "creances",
    icon: "💰",
    label: "Créances",
    roles: ["gerant"]
}, {
    id: "catalog",
    icon: "🏷️",
    label: "Catalogue",
    roles: ["gerant"]
}, {
    id: "reports",
    icon: "📈",
    label: "Rapports",
    roles: ["gerant"]
}, {
    id: "settings",
    icon: "⚙️",
    label: "Paramètres",
    roles: ["gerant"]
}, {
    id: "users",
    icon: "👤",
    label: "Utilisateurs",
    roles: ["gerant"]
}];

function buildNav() {
    let a = $("nav");
    a.innerHTML = "", PAGES.filter(t => t.roles.includes(U.role)).forEach(t => {
        var e = document.createElement("button");
        e.innerHTML = `<span class="icon">${t.icon}</span>` + t.label, e.onclick = () => nav(t.id), e.dataset.page = t.id, a.appendChild(e)
    })
}

function nav(e) {
    currentPage = e, $$("page").forEach(t => t.classList.remove("active"));
    var t = $("p-" + e);
    t && t.classList.add("active"), $$("#nav button").forEach(t => t.classList.toggle("active", t.dataset.page === e)), $("sidebar").classList.remove("open"), $("overlay").classList.remove("open"), "dashboard" === e && loadDashboard(), "orders" === e && (ordersPage = 1, loadOrders()), "clients" === e && loadClients(), "creances" === e && loadCreances(), "catalog" === e && loadCatalogAdmin(), "users" === e && loadUsers(), "settings" === e && loadSettings(), "reports" === e && initReports()
}

function toggleSidebar() {
    $("sidebar").classList.toggle("open"), $("overlay").classList.toggle("open")
}

function toast(t, e = "ok") {
    let a = document.createElement("div");
    a.className = "toast toast-" + e, a.textContent = t, document.body.appendChild(a), setTimeout(() => a.remove(), 3500)
}


/* ══════ SECTION 5 : DASHBOARD ════════════════════════════════════ */

async function loadDashboard() {
    try {
        var t = await api("/api/stats");
        $("dash-stats").innerHTML = `\n      <div class="stat-card"><div class="val">${fmt(t.today.ca)}</div><div class="lbl">CA du jour (${t.today.n} cmd)</div></div>\n      <div class="stat-card"><div class="val" style="color:var(--warn)">${t.pending}</div><div class="lbl">En cours</div></div>\n      <div class="stat-card"><div class="val" style="color:var(--ok)">${t.ready}</div><div class="lbl">Prêtes</div></div>\n      <div class="stat-card"><div class="val" style="color:var(--err)">${t.late}</div><div class="lbl">En retard</div></div>\n    `, drawBarChart($("dash-chart"), t.days.map(t => t.label), t.days.map(t => t.ca))
    } catch (t) {
        toast(t.message, "err")
    }
}

function drawBarChart(t, o, i) {
    let n = t.getContext("2d"),
        r = t.width = t.parentElement.clientWidth - 40,
        l = t.height = 180,
        d = (n.clearRect(0, 0, r, l), Math.max(...i, 1)),
        c = Math.min(40, (r - 60) / o.length - 8);
    n.font = "11px sans-serif", n.fillStyle = "#5f6368", n.textAlign = "center", o.forEach((t, e) => {
        var a = 40 + e * ((r - 80) / (o.length - 1 || 1)),
            s = i[e] / d * (l - 50);
        n.fillStyle = "#1a73e8", n.fillRect(a - c / 2, l - 30 - s, c, s), n.fillStyle = "#5f6368", n.fillText(t, a, l - 10), i[e] && n.fillText(fmt(i[e]), a, l - 35 - s)
    })
}


/* ══════ SECTION 6 : CATALOGUE (GRILLE COMMANDE) & PANIER ════════ */

function renderCatalogGrid() {
    $("catalog-grid").innerHTML = CAT.map(t => `\n    <button class="btn-o" style="padding:10px;text-align:center;min-height:60px" onclick="addToCart(${t.id})">\n      <div style="font-size:1.3rem">${esc(t.icon)}</div>\n      <div style="font-size:.8rem;margin-top:2px">${esc(t.name)}</div>\n      <div style="font-size:.75rem;color:var(--txt2)">${fmt(t.price)}</div>\n    </button>`).join("")
}

function addToCart(e) {
    var t, a = CAT.find(t => t.id === e);
    a && ((t = CART.find(t => t.id === e)) ? t.qty++ : CART.push({
        id: a.id,
        name: a.name,
        icon: a.icon,
        price: a.price,
        qty: 1
    }), renderCart())
}

function renderCart() {
    try {
        sessionStorage.setItem("pp_cart", JSON.stringify(CART))
    } catch (t) {}
    CART.length ? ($("cart-section").classList.remove("hidden"), $("cart-body").innerHTML = CART.map((t, e) => `<tr>\n    <td>${esc(t.icon)} ${esc(t.name)}</td>\n    <td style="width:100px"><div class="flex items-center gap-8">\n      <button class="btn-o btn-sm" onclick="cartQty(${e},-1)" style="padding:4px 10px">−</button>\n      <span>${t.qty}</span>\n      <button class="btn-o btn-sm" onclick="cartQty(${e},1)" style="padding:4px 10px">+</button>\n    </div></td>\n    <td class="text-right">${fmt(t.price*t.qty)}</td>\n    <td><button class="btn-sm" style="background:none;color:var(--err)" onclick="cartRemove(${e})">✕</button></td>\n  </tr>`).join("")) : $("cart-section").classList.add("hidden"), updateTotal()
}

function cartQty(t, e) {
    CART[t].qty = Math.max(1, CART[t].qty + e), renderCart()
}

function cartRemove(t) {
    CART.splice(t, 1), renderCart()
}

function getSubtotal() {
    var t, e;
    return "article" === orderType ? CART.reduce((t, e) => t + e.price * e.qty, 0) : (t = parseFloat($("o-weight")?.value) || 0, e = parseInt($("o-pkg")?.value) || 0, Math.round(t * e))
}

function updateTotal() {
    var t = getSubtotal(),
        e = parseInt($("o-discount")?.value) || 0;
    $("order-total").textContent = "Total : " + fmt(Math.max(0, t - e))
}

function setOrderType(a) {
    orderType = a, $$("#order-type-tabs button").forEach((t, e) => t.classList.toggle("active", e === ("article" === a ? 0 : 1))), $("article-section").classList.toggle("hidden", "article" !== a), $("kilo-section").classList.toggle("hidden", "kilo" !== a), updateTotal()
}

document.addEventListener("input", t => {
    ["o-weight", "o-pkg", "o-discount"].includes(t.target?.id) && updateTotal()
});

$("o-payment").addEventListener("change", t => {
    $("acompte-section").classList.toggle("hidden", "Crédit" !== t.target.value)
});


/* ══════ SECTION 7 : COMMANDE — CRÉATION & SOUMISSION ════════════ */

let searchTimer;

function searchClient(e) {
    clearTimeout(searchTimer), e.length < 2 ? $("client-suggest").innerHTML = "" : searchTimer = setTimeout(async () => {
        try {
            SEARCH_RESULTS = await api("/api/clients/search?q=" + encodeURIComponent(e));
            SEARCH_RESULTS.length ? $("client-suggest").innerHTML = '<div style="position:absolute;top:0;left:0;right:0;background:#fff;border:1px solid var(--brd);border-radius:6px;box-shadow:var(--shadow);z-index:10;max-height:200px;overflow-y:auto">' + SEARCH_RESULTS.map((t,i) => `<div style="padding:10px;cursor:pointer;min-height:44px;display:flex;align-items:center" onclick="pickClient(${i})">${esc(t.name)} <span style="color:var(--txt2);margin-left:8px">${esc(t.phone||"")}</span></div>`).join("") + "</div>" : $("client-suggest").innerHTML = ""
        } catch (t) {}
    }, 300)
}

function pickClient(i) {
    var t = SEARCH_RESULTS[i];
    if(t) $("o-client").value = t.name, $("o-phone").value = t.phone||"";
    $("client-suggest").innerHTML = ""
}

async function submitOrder() {
    var t = $("submit-order-btn");
    t.disabled = !0, t.innerHTML = '<span class="spinner"></span>';
    try {
        var e = {
                client: $("o-client").value,
                phone: $("o-phone").value,
                type: orderType,
                payment: $("o-payment").value,
                promise_date: $("o-promise").value,
                discount: parseInt($("o-discount")?.value) || 0,
                discount_reason: $("o-disc-reason")?.value || "",
                acompte: parseInt($("o-acompte")?.value) || 0,
                acompte_method: $("o-acompte-method")?.value || "Espèces"
            },
            a = ("article" === orderType ? e.items = CART.map(t => ({
                id: t.id,
                qty: t.qty
            })) : (e.weight = parseFloat($("o-weight").value), e.price_kg = parseInt($("o-pkg").value), e.kilo_items = $("o-kitems").value), await api("/api/orders", {
                method: "POST",
                body: JSON.stringify(e)
            }));
        toast("Commande " + a.code + " créée !", "ok"), CART = [], sessionStorage.removeItem("pp_cart"), renderCart(), $("o-client").value = "", $("o-phone").value = "", $("o-discount").value = "0", $("o-disc-reason").value = "", $("o-acompte").value = "0", "kilo" === orderType && ($("o-weight").value = "", $("o-kitems").value = ""), showReceipt(a, "depot")
    } catch (t) {
        toast(t.message, "err")
    }
    t.disabled = !1, t.textContent = "✅ Valider la commande"
}


/* ══════ SECTION 8 : REÇU / FACTURE & IMPRESSION ════════════════ */

function showReceipt(t, e) {
    var a = t.items || [],
        s = S.shop_name || "PressingPro",
        e = "depot" === e,
        o = S.invoice_format || "A6",
        i = {
            A6: {
                w: "105mm",
                h: "148mm",
                fs: "11px",
                fsh: "13px"
            },
            A5: {
                w: "148mm",
                h: "210mm",
                fs: "12px",
                fsh: "14px"
            },
            A4: {
                w: "210mm",
                h: "297mm",
                fs: "13px",
                fsh: "15px"
            }
        };
    let n = i[o] || i.A6;
    var i = S.invoice_footer || "Merci de votre confiance !",
        r = S.invoice_header || "",
        l = S.invoice_logo || "";
    let d = `<div class="receipt" style="width:${n.w};max-width:100%;font-size:${n.fs};padding:8px">`,
        c = (l && (d += `<div class="center" style="margin-bottom:4px"><img src="${esc(l)}" style="max-height:${"A4"===o?"60px":"40px"};max-width:80%"></div>`), d += `<div class="center" style="font-size:${n.fsh}"><strong>${esc(s)}</strong></div>`, S.shop_address && (d += `<div class="center" style="font-size:${n.fs}">${esc(S.shop_address)}</div>`), S.shop_phone && (d += `<div class="center" style="font-size:${n.fs}">Tél: ${esc(S.shop_phone)}</div>`), S.shop_niu && (d += `<div class="center" style="font-size:${n.fs}">NIU: ${esc(S.shop_niu)}</div>`), r && (d += `<div class="center" style="font-size:${n.fs};white-space:pre-line">${esc(r)}</div>`), d += `<hr>\n    <div class="center"><strong>${e?"BON DE DÉPÔT":"FACTURE"}</strong></div>\n    ${!e&&t.invoice_no?'<div class="center">N° '+esc(t.invoice_no)+"</div>":""}\n    <div>Code : <strong>${esc(t.code)}</strong></div>\n    <div>Date : ${new Date(t.created_at).toLocaleString("fr-FR")}</div>\n    <div>Client : ${esc(t.client_name)}${t.phone?" — "+esc(t.phone):""}</div>\n    ${t.promise_date?"<div>Retrait prévu : "+esc(t.promise_date)+"</div>":""}\n    <hr>`, "article" === t.type && a.length ? (d += '<table><tr><th>Article</th><th style="text-align:right">Qté</th><th style="text-align:right">Prix</th></tr>', a.forEach(t => {
            d += `<tr><td>${esc(t.name)}</td><td style="text-align:right">${t.qty}</td><td style="text-align:right">${fmt(t.price*t.qty)}</td></tr>`
        }), d += "</table>") : "kilo" === t.type && (d += `<div>${t.weight} kg × ${fmt(t.price_kg)}/kg</div>`, t.kilo_items) && (d += `<div style="font-size:${n.fs}">${esc(t.kilo_items)}</div>`), d += `<hr><div><strong>Sous-total : ${fmt(t.subtotal)}</strong></div>`, t.discount && (d += `<div>Remise : -${fmt(t.discount)}${t.discount_reason?" ("+esc(t.discount_reason)+")":""}</div>`), d = (d += `<div style="font-size:1.1em"><strong>Total : ${fmt(t.total)}</strong></div>`) + `<hr><div>Payé : ${fmt(t.paid_total)}</div>`, 0 < t.balance ? d += `<div style="color:red"><strong>Reste à payer : ${fmt(t.balance)}</strong></div>` : d += '<div style="color:green"><strong>Soldé</strong></div>', t.payments && t.payments.length && (d += `<div style="font-size:${n.fs};margin-top:4px">Paiements :</div>`, t.payments.forEach(t => {
            d += `<div style="font-size:${n.fs}">  ${fmt(t.amount)} (${esc(t.method)}) — ${new Date(t.created_at).toLocaleString("fr-FR")}</div>`
        })), d += `<hr><div class="center" style="font-size:${n.fs}">${esc(i)}</div></div>`, "");
    e && t.track_token && t.phone && (l = location.origin + "/suivi/" + t.track_token, o = t.phone.replace(/\s/g, "").replace(/^\+/, ""), r = encodeURIComponent(`Bonjour ${esc(t.client_name)},\nVotre dépôt ${esc(t.code)} a été enregistré chez ${esc(s)}.\n\nSuivez l'avancement ici :\n${l}\n\nMerci pour votre confiance !`), c = `<a href="https://wa.me/${o}?text=${r}" target="_blank" class="btn btn-sm" style="background:#25D366;border:none;display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#fff">💬 Envoyer sur WhatsApp</a>`), showModal(`<h3>${e?"🧾 Bon de dépôt":"🧾 Facture"}</h3>${d}\n    <div class="actions"><button class="btn-o" onclick="closeModal()">Fermer</button>\n    ${c}\n    <button class="btn" onclick="printReceipt()">🖨️ Imprimer</button></div>`), $("receipt-print").innerHTML = d
}

function printReceipt() {
    $("receipt-print").style.display = "block", window.print(), $("receipt-print").style.display = "none"
}


/* ══════ SECTION 9 : COMMANDES — LISTE & DÉTAIL ══════════════════ */

async function loadOrders() {
    var t = $("os-status").value,
        e = $("os-q").value;
    try {
        var a = await api(`/api/orders?status=${t}&q=${encodeURIComponent(e)}&page=` + ordersPage);
        $("orders-body").innerHTML = a.orders.map(t => `<tr style="cursor:pointer" onclick="showOrder(${t.id})">\n      <td><strong>${esc(t.code)}</strong></td>\n      <td class="truncate">${esc(t.client_name)}</td>\n      <td class="text-right">${fmt(t.total)}</td>\n      <td class="text-right" style="color:${0<t.balance?"var(--err)":"var(--ok)"}">${0<t.balance?fmt(t.balance):"Soldé"}</td>\n      <td><span class="badge badge-${t.status}">${statusLabel(t.status)}</span></td>\n      <td style="white-space:nowrap">${t.day}</td>\n      <td><button class="btn-o btn-sm">Voir</button></td>\n    </tr>`).join("") || '<tr><td colspan="7" class="text-center" style="padding:20px;color:var(--txt2)">Aucune commande</td></tr>', $("orders-pag").innerHTML = "", 1 < a.pages && (1 < ordersPage && ($("orders-pag").innerHTML += '<button class="btn-o btn-sm" onclick="ordersPage--;loadOrders()">← Préc</button>'), $("orders-pag").innerHTML += `<span style="padding:8px">${ordersPage}/${a.pages}</span>`, ordersPage < a.pages) && ($("orders-pag").innerHTML += '<button class="btn-o btn-sm" onclick="ordersPage++;loadOrders()">Suiv →</button>')
    } catch (t) {
        toast(t.message, "err")
    }
}

function statusLabel(t) {
    return {
        depose: "Déposé",
        traitement: "En traitement",
        pret: "Prêt",
        livre: "Livré",
        annule: "Annulé"
    } [t] || t
}

async function showOrder(t) {
    nav("order-detail"), $("order-detail-content").innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
        let a = await api("/api/orders/" + t);
        var e, o, i, n = a.items || [],
            r = {
                depose: ["traitement"],
                traitement: ["pret"],
                pret: ["livre"]
            } [a.status] || [],
            l = ["depose", "traitement", "pret"].includes(a.status),
            d = 0 < a.balance && "annule" !== a.status;
        let s = `<div class="card">\n      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:8px">\n        <h2>${esc(a.code)} <span class="badge badge-${a.status}">${statusLabel(a.status)}</span></h2>\n        <button class="btn-o btn-sm" onclick="nav('orders')">← Retour</button>\n      </div>\n      <div class="grid2 mt-8">\n        <div><strong>Client :</strong> ${esc(a.client_name)}${a.phone?" — "+esc(a.phone):""}</div>\n        <div><strong>Date :</strong> ${new Date(a.created_at).toLocaleString("fr-FR")}</div>\n        <div><strong>Retrait prévu :</strong> ${esc(a.promise_date||"—")}</div>\n        <div><strong>Paiement :</strong> ${esc(a.payment_mode)}</div>\n      </div>\n      <hr style="margin:16px 0;border:none;border-top:1px solid var(--brd)">`;
        "article" === a.type && n.length ? (s += '<table><thead><tr><th>Article</th><th>Qté</th><th class="text-right">Prix</th></tr></thead><tbody>', n.forEach(t => {
            s += `<tr><td>${esc(t.icon||"")} ${esc(t.name)}</td><td>${t.qty}</td><td class="text-right">${fmt(t.price*t.qty)}</td></tr>`
        }), s += "</tbody></table>") : "kilo" === a.type && (s += `<p>${a.weight} kg × ${fmt(a.price_kg)}/kg${a.kilo_items?" — "+esc(a.kilo_items):""}</p>`), s += '<div class="mt-8"><strong>Sous-total :</strong> ' + fmt(a.subtotal), a.discount && (s += " | <strong>Remise :</strong> -" + fmt(a.discount) + (a.discount_reason ? " (" + esc(a.discount_reason) + ")" : "")), s = (s += ` | <strong>Total :</strong> ${fmt(a.total)}</div>`) + `<div class="mt-8"><strong>Payé :</strong> ${fmt(a.paid_total)} | <strong style="color:${0<a.balance?"var(--err)":"var(--ok)"}">Solde : ${0<a.balance?fmt(a.balance):"Soldé"}</strong></div>`, a.payments && a.payments.length && (s += `<details class="mt-8"><summary style="cursor:pointer;font-weight:600">💰 Paiements (${a.payments.length})</summary><table><thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Par</th></tr></thead><tbody>`, a.payments.forEach(t => {
            s += `<tr><td>${new Date(t.created_at).toLocaleString("fr-FR")}</td><td>${fmt(t.amount)}</td><td>${esc(t.method)}</td><td>${esc(t.created_by)}</td></tr>`
        }), s += "</tbody></table></details>"), a.status_history && a.status_history.length && (s += `<details class="mt-8"><summary style="cursor:pointer;font-weight:600">📜 Historique statuts (${a.status_history.length})</summary><table><thead><tr><th>Date</th><th>Transition</th><th>Par</th><th>Note</th></tr></thead><tbody>`, a.status_history.forEach(t => {
            s += `<tr><td>${new Date(t.changed_at).toLocaleString("fr-FR")}</td><td>${t.old_status?statusLabel(t.old_status)+" → ":""}${statusLabel(t.new_status)}</td><td>${esc(t.changed_by)}</td><td>${esc(t.note||"")}</td></tr>`
        }), s += "</tbody></table></details>"), s += '<div class="flex gap-8 mt-16" style="flex-wrap:wrap">', d && (s += `<button class="btn btn-ok btn-sm" onclick="showPayModal(${a.id},${a.balance})">💵 Encaisser</button>`), r.forEach(t => {
            var e = {
                traitement: "▶ Traitement",
                pret: "✅ Prêt",
                livre: "📦 Livrer"
            } [t] || t;
            s += `<button class="btn btn-sm" onclick="changeStatus(${a.id},'${t}')">${e}</button>`
        }), l && (s += `<button class="btn-d btn-sm" onclick="changeStatus(${a.id},'annule')">❌ Annuler</button>`), "annule" !== a.status && (s += `<button class="btn-o btn-sm" onclick="printOrder(${a.id},'${"livre"===a.status?"facture":"depot"}')">🖨️ ${"livre"===a.status?"Facture":"Bon"}</button>`), a.track_token && a.phone && (e = location.origin + "/suivi/" + a.track_token, o = a.phone.replace(/\s/g, "").replace(/^\+/, ""), i = encodeURIComponent("Bonjour " + esc(a.client_name) + ",\nSuivez votre commande " + esc(a.code) + " ici :\n" + e), s = s + `<a href="https://wa.me/${o}?text=${i}" target="_blank" class="btn btn-sm" style="background:#25D366;border:none;display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#fff">💬 WhatsApp</a>` + `<button class="btn-o btn-sm" onclick="navigator.clipboard.writeText('${e}');toast('Lien copié !','ok')">📋 Copier lien suivi</button>`), s += "</div></div>", $("order-detail-content").innerHTML = s
    } catch (t) {
        toast(t.message, "err"), nav("orders")
    }
}

async function changeStatus(t, e) {
    var a = "annule" === e ? prompt("Motif d'annulation :") : null;
    if ("annule" !== e || null !== a) try {
        await api(`/api/orders/${t}/status`, {
            method: "PUT",
            body: JSON.stringify({
                status: e,
                note: a
            })
        }), toast("Statut mis à jour", "ok"), showOrder(t)
    } catch (t) {
        toast(t.message, "err")
    }
}

function showPayModal(t, e) {
    showModal(`<h3>💵 Encaisser un paiement</h3>\n    <div class="form-group"><label>Montant (max ${fmt(e)})</label><input id="pay-amt" type="number" min="1" max="${e}" value="${e}"></div>\n    <div class="form-group"><label>Mode</label><select id="pay-met"><option>Espèces</option><option>Mobile Money</option></select></div>\n    <div class="actions"><button class="btn-o" onclick="closeModal()">Annuler</button>\n    <button class="btn btn-ok" onclick="doPay(${t})">Valider</button></div>`)
}

async function doPay(t) {
    try {
        await api(`/api/orders/${t}/pay`, {
            method: "POST",
            body: JSON.stringify({
                amount: parseInt($("pay-amt").value),
                method: $("pay-met").value
            })
        }), closeModal(), toast("Paiement enregistré", "ok"), showOrder(t)
    } catch (t) {
        toast(t.message, "err")
    }
}

async function printOrder(t, e) {
    try {
        showReceipt(await api("/api/orders/" + t), e)
    } catch (t) {
        toast(t.message, "err")
    }
}


/* ══════ SECTION 10 : CLIENTS ════════════════════════════════════ */
var CLIENTS_LIST = [];

async function loadClients() {
    try {
        CLIENTS_LIST = await api("/api/clients");
        renderClientsTable();
        $("clients-list-card").style.display = "";
        $("client-detail-card").style.display = "none";
    } catch (t) {
        toast(t.message, "err")
    }
}

function renderClientsTable() {
    var search = ($("clients-search-input").value || "").toLowerCase();
    var dueOnly = $("clients-due-only").checked;
    var filtered = CLIENTS_LIST.filter(function(c) {
        if (dueOnly && c.due <= 0) return false;
        if (search && !(c.name||"").toLowerCase().includes(search) && !(c.phone||"").toLowerCase().includes(search)) return false;
        return true;
    });
    $("clients-body").innerHTML = filtered.map(function(t, idx) {
        return '<tr style="cursor:pointer" onclick="showClientDetail(' + t.id + ')">' +
            '<td>' + esc(t.name) + '</td>' +
            '<td>' + esc(t.phone || "—") + '</td>' +
            '<td>' + t.n + '</td>' +
            '<td class="text-right">' + fmt(t.ca) + '</td>' +
            '<td class="text-right" style="color:' + (t.due > 0 ? "var(--err)" : "var(--ok)") + '">' + (t.due > 0 ? fmt(t.due) : "—") + '</td>' +
            '<td><button class="btn-o btn-sm" onclick="event.stopPropagation();editClientModal(' + t.id + ')">✏️</button></td>' +
            '</tr>';
    }).join("") || '<tr><td colspan="6" class="text-center">Aucun client</td></tr>';
}

function filterClientsTable() { renderClientsTable(); }

function backToClientsList() {
    $("clients-list-card").style.display = "";
    $("client-detail-card").style.display = "none";
}

async function showClientDetail(id) {
    try {
        var c = await api("/api/clients/" + id);
        $("clients-list-card").style.display = "none";
        $("client-detail-card").style.display = "";
        $("client-detail-title").textContent = "📋 " + c.name;

        var statsHtml = '<div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">' +
            '<div class="stat-card"><div class="stat-val">' + c.total_orders + '</div><div class="stat-label">Commandes</div></div>' +
            '<div class="stat-card"><div class="stat-val">' + fmt(c.ca) + '</div><div class="stat-label">CA total</div></div>' +
            '<div class="stat-card"><div class="stat-val" style="color:' + (c.due > 0 ? "var(--err)" : "var(--ok)") + '">' + fmt(c.due) + '</div><div class="stat-label">Créances</div></div>' +
            '</div>';

        var infoHtml = '<div class="card" style="margin-bottom:16px;padding:12px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.9rem">' +
            '<div><strong>Téléphone :</strong> ' + esc(c.phone || "—") + '</div>' +
            '<div><strong>Email :</strong> ' + esc(c.email || "—") + '</div>' +
            '<div><strong>Adresse :</strong> ' + esc(c.address || "—") + '</div>' +
            '<div><strong>Notes :</strong> ' + esc(c.notes || "—") + '</div>' +
            '</div>' +
            '<div style="margin-top:10px"><button class="btn btn-sm" onclick="editClientModal(' + c.id + ')">✏️ Modifier</button></div>' +
            '</div>';

        var ordersHtml = '<h3 style="margin:16px 0 8px">Historique des commandes</h3>';
        if (c.orders && c.orders.length > 0) {
            ordersHtml += '<div style="overflow-x:auto"><table><thead><tr><th>Code</th><th>Date</th><th>Type</th><th>Statut</th><th class="text-right">Total</th><th class="text-right">Payé</th><th class="text-right">Solde</th></tr></thead><tbody>';
            ordersHtml += c.orders.map(function(o) {
                var statusClass = o.status === 'livre' ? 'badge-ok' : o.status === 'annule' ? 'badge-err' : o.status === 'pret' ? 'badge-warn' : 'badge-info';
                var statusLabel = o.status === 'depose' ? 'Déposé' : o.status === 'traitement' ? 'Traitement' : o.status === 'pret' ? 'Prêt' : o.status === 'livre' ? 'Livré' : 'Annulé';
                return '<tr style="cursor:pointer" onclick="showOrder(' + o.id + ')">' +
                    '<td>' + esc(o.code) + '</td>' +
                    '<td>' + esc(o.day) + '</td>' +
                    '<td>' + esc(o.type) + '</td>' +
                    '<td><span class="badge ' + statusClass + '">' + statusLabel + '</span></td>' +
                    '<td class="text-right">' + fmt(o.total) + '</td>' +
                    '<td class="text-right">' + fmt(o.paid) + '</td>' +
                    '<td class="text-right" style="color:' + (o.balance > 0 ? "var(--err)" : "var(--ok)") + '">' + (o.balance > 0 ? fmt(o.balance) : "—") + '</td>' +
                    '</tr>';
            }).join("");
            ordersHtml += '</tbody></table></div>';
        } else {
            ordersHtml += '<p style="color:var(--muted);text-align:center;padding:20px">Aucune commande</p>';
        }

        $("client-detail-content").innerHTML = statsHtml + infoHtml + ordersHtml;
    } catch (t) {
        toast(t.message, "err")
    }
}

async function editClientModal(id) {
    try {
        var c = await api("/api/clients/" + id);
        showModal(
            '<h3>Modifier le client</h3>' +
            '<div class="form-group"><label>Nom *</label><input id="edit-cl-name" value="' + esc(c.name) + '"></div>' +
            '<div class="form-group"><label>Téléphone</label><input id="edit-cl-phone" value="' + esc(c.phone || "") + '"></div>' +
            '<div class="form-group"><label>Email</label><input id="edit-cl-email" type="email" value="' + esc(c.email || "") + '"></div>' +
            '<div class="form-group"><label>Adresse</label><input id="edit-cl-address" value="' + esc(c.address || "") + '"></div>' +
            '<div class="form-group"><label>Notes</label><textarea id="edit-cl-notes" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--glass);color:var(--text)">' + esc(c.notes || "") + '</textarea></div>' +
            '<div class="actions"><button class="btn-o" onclick="closeModal()">Annuler</button>' +
            '<button class="btn" onclick="saveClient(' + id + ')">Enregistrer</button></div>'
        );
    } catch(t) {
        toast(t.message, "err");
    }
}

async function saveClient(id) {
    var data = {
        name: $("edit-cl-name").value,
        phone: $("edit-cl-phone").value,
        email: $("edit-cl-email").value,
        address: $("edit-cl-address").value,
        notes: $("edit-cl-notes").value
    };
    if (!data.name.trim()) return toast("Le nom est requis", "err");
    try {
        await api("/api/clients/" + id, { method: "PUT", body: JSON.stringify(data) });
        closeModal();
        toast("Client modifié", "ok");
        loadClients();
        showClientDetail(id);
    } catch(t) {
        toast(t.message, "err");
    }
}


/* ══════ SECTION 10b : CRÉANCES ═════════════════════════════════ */

async function loadCreances() {
    try {
        var data = await api("/api/creances");
        $("creances-summary").textContent = data.count + " client" + (data.count > 1 ? "s" : "") + " · Total dû : " + fmt(data.total_due) + " F";
        $("creances-body").innerHTML = data.clients.map(function(c, i) {
            return '<tr>' +
                '<td><a href="#" onclick="nav(\'clients\');setTimeout(function(){showClientDetail(' + c.id + ')},300);return false">' + esc(c.name) + '</a></td>' +
                '<td>' + esc(c.phone || '-') + '</td>' +
                '<td class="text-right">' + c.unpaid_orders + '</td>' +
                '<td class="text-right">' + fmt(c.total) + '</td>' +
                '<td class="text-right">' + fmt(c.paid) + '</td>' +
                '<td class="text-right" style="color:var(--warn);font-weight:600">' + fmt(c.due) + '</td>' +
                '<td><button class="btn btn-sm" onclick="quickPayment(' + c.id + ',' + c.due + ',\'' + esc(c.name).replace(/'/g, "\\'") + '\')">💳 Encaisser</button></td>' +
                '</tr>';
        }).join("");
    } catch(t) {
        toast(t.message, "err");
    }
}

function quickPayment(clientId, due, name) {
    showModal("Encaissement rapide — " + name, '<p style="margin-bottom:12px">Montant dû : <strong style="color:var(--warn)">' + fmt(due) + ' F</strong></p>' +
        '<label>Montant à encaisser<input id="qp-amount" type="number" value="' + due + '" min="1" max="' + due + '"></label>' +
        '<label>Mode de paiement<select id="qp-method"><option>Espèces</option><option>Mobile Money</option></select></label>' +
        '<button class="btn" style="width:100%;margin-top:12px" onclick="submitQuickPayment(' + clientId + ')">Valider le paiement</button>');
}

async function submitQuickPayment(clientId) {
    try {
        var amount = parseInt($("qp-amount").value);
        var method = $("qp-method").value;
        if (!amount || amount <= 0) return toast("Montant invalide", "err");
        // Get unpaid orders for this client
        var data = await api("/api/clients/" + clientId);
        var unpaid = data.orders.filter(function(o) { return o.status !== 'annule' && o.total > (o.paid || 0); });
        if (!unpaid.length) return toast("Aucune commande impayée", "err");
        // Pay oldest orders first
        var remaining = amount;
        for (var i = 0; i < unpaid.length && remaining > 0; i++) {
            var owed = unpaid[i].total - (unpaid[i].paid || 0);
            var pay = Math.min(remaining, owed);
            await api("/api/payments", { method: "POST", body: JSON.stringify({ order_id: unpaid[i].id, amount: pay, method: method }) });
            remaining -= pay;
        }
        closeModal();
        toast("Paiement enregistré", "ok");
        loadCreances();
    } catch(t) {
        toast(t.message, "err");
    }
}

/* ══════ SECTION 11 : CATALOGUE — ADMINISTRATION CRUD ════════════ */

async function loadCatalogAdmin() {
    try {
        CAT = await api("/api/catalog");
        $("catalog-body").innerHTML = CAT.map(t => `<tr>\n      <td style="font-size:1.3rem">${esc(t.icon)}</td><td>${esc(t.name)}</td><td class="text-right">${fmt(t.price)}</td>\n      <td><button class="btn-o btn-sm" onclick="editCatalogItem(${t.id})">✏️</button>\n      <button class="btn-sm" style="background:none;color:var(--err)" onclick="deleteCatalogItem(${t.id})">🗑️</button></td>\n    </tr>`).join("")
    } catch (t) {
        toast(t.message, "err")
    }
}

function showCatalogModal(t, e, a, s) {
    showModal(`<h3>${t?"Modifier":"Ajouter"} un article</h3>\n    <div class="form-group"><label>Nom</label><input id="cat-name" value="${esc(e||"")}"></div>\n    <div class="grid2"><div class="form-group"><label>Prix (FCFA)</label><input id="cat-price" type="number" value="${a||""}"></div>\n    <div class="form-group"><label>Icône</label><input id="cat-icon" value="${esc(s||"🧲")}" maxlength="4"></div></div>\n    <div class="actions"><button class="btn-o" onclick="closeModal()">Annuler</button>\n    <button class="btn" onclick="saveCatalogItem(${t||0})">Enregistrer</button></div>`)
}

function editCatalogItem(id) {
    var t = CAT.find(c => c.id === id);
    if(t) showCatalogModal(t.id, t.name, t.price, t.icon)
}

async function saveCatalogItem(t) {
    var e = {
        name: $("cat-name").value,
        price: parseInt($("cat-price").value),
        icon: $("cat-icon").value
    };
    try {
        t ? await api("/api/catalog/" + t, {
            method: "PUT",
            body: JSON.stringify(e)
        }) : await api("/api/catalog", {
            method: "POST",
            body: JSON.stringify(e)
        }), closeModal(), toast("Article enregistré", "ok");
        var a = await api("/api/catalog");
        CAT = a, renderCatalogGrid(), loadCatalogAdmin()
    } catch (t) {
        toast(t.message, "err")
    }
}

async function deleteCatalogItem(t) {
    if (confirm("Supprimer cet article ?")) try {
        await api("/api/catalog/" + t, {
            method: "DELETE"
        });
        var e = await api("/api/catalog");
        CAT = e, renderCatalogGrid(), loadCatalogAdmin(), toast("Article supprimé", "ok")
    } catch (t) {
        toast(t.message, "err")
    }
}


/* ══════ SECTION 12 : PARAMÈTRES ═════════════════════════════════ */

function loadSettings() {
    $("s-name").value = S.shop_name || "", $("s-addr").value = S.shop_address || "", $("s-phone").value = S.shop_phone || "", $("s-niu").value = S.shop_niu || "", $("s-kilo").value = S.kilo_price || 700, $("s-delay").value = S.default_delay || 2, $("s-maxdisc").value = S.max_discount_percent ?? 100, $("s-invoice-fmt").value = S.invoice_format || "A6", $("s-invoice-header").value = S.invoice_header || "", $("s-invoice-footer").value = S.invoice_footer || "Merci de votre confiance !", S.invoice_logo ? $("s-logo-preview").innerHTML = `<img src="${esc(S.invoice_logo)}" style="max-height:60px;max-width:160px">` : $("s-logo-preview").innerHTML = '<span style="color:var(--txt2);font-size:.85rem">Aucun logo</span>'
}

async function saveSettings() {
    try {
        S = await api("/api/settings", {
            method: "PUT",
            body: JSON.stringify({
                shop_name: $("s-name").value,
                shop_address: $("s-addr").value,
                shop_phone: $("s-phone").value,
                shop_niu: $("s-niu").value,
                kilo_price: $("s-kilo").value,
                default_delay: $("s-delay").value,
                max_discount_percent: $("s-maxdisc").value,
                invoice_format: $("s-invoice-fmt").value,
                invoice_header: $("s-invoice-header").value,
                invoice_footer: $("s-invoice-footer").value
            })
        }), $("shop-title").textContent = S.shop_name, document.title = S.shop_name, toast("Paramètres enregistrés", "ok")
    } catch (t) {
        toast(t.message, "err")
    }
}

function previewLogo(t) {
    t = t.files[0];
    if (t)
        if (1048576 < t.size) toast("Logo trop volumineux (max 1 Mo)", "err");
        else {
            let e = new FileReader;
            e.onload = async function() {
                var t = e.result;
                $("s-logo-preview").innerHTML = `<img src="${esc(t)}" style="max-height:60px;max-width:160px">`;
                try {
                    await api("/api/settings/logo", {
                        method: "POST",
                        body: JSON.stringify({
                            logo: t
                        })
                    }), S.invoice_logo = t, toast("Logo enregistré", "ok")
                } catch (t) {
                    toast(t.message, "err")
                }
            }, e.readAsDataURL(t)
        }
}

async function removeLogo() {
    try {
        await api("/api/settings/logo", {
            method: "DELETE"
        }), S.invoice_logo = "", $("s-logo-preview").innerHTML = '<span style="color:var(--txt2);font-size:.85rem">Aucun logo</span>', $("s-logo-file").value = "", toast("Logo supprimé", "ok")
    } catch (t) {
        toast(t.message, "err")
    }
}


/* ══════ SECTION 13 : GESTION DES UTILISATEURS ═══════════════════ */

/* ⚠️ MISMATCH : showUserModal() ne propose que "caisse" et "gerant".
   Le backend supporte aussi "superviseur". À corriger en P0.4 ou P1. */

async function loadUsers() {
    try {
        USERS_LIST = await api("/api/users");
        $("users-body").innerHTML = USERS_LIST.map((t,i) => `<tr>\n      <td>${esc(t.username)}</td><td>${esc(t.name)}</td>\n      <td><span class="badge" style="background:var(--pri-l);color:var(--pri)">${esc(t.role)}</span></td>\n      <td>${t.active?"✅":"❌"}</td>\n      <td><button class="btn-o btn-sm" onclick="editUser(${i})"> ✏️</button></td>\n    </tr>`).join("")
    } catch (t) {
        toast(t.message, "err")
    }
}

function showUserModal(t) {
    var e = !!t;
    showModal(`<h3>${e?"Modifier":"Nouvel"} utilisateur</h3>\n    ${e?"":'<div class="form-group"><label>Identifiant</label><input id="u-login"></div>'}\n    <div class="form-group"><label>Nom</label><input id="u-name" value="${esc(t?.name||"")}"></div>\n    <div class="form-group"><label>Rôle</label><select id="u-role">\n      <option ${"caissier"===t?.role?"selected":""}>caissier</option>\n      <option ${"superviseur"===t?.role?"selected":""}>superviseur</option>\n      <option ${"gerant"===t?.role?"selected":""}>gerant</option></select></div>\n    <div class="form-group"><label>${e?"Nouveau mot de passe (vide = inchangé)":"Mot de passe"}</label><input id="u-pwd" type="password"></div>\n    ${e?`<div class="form-group"><label><input type="checkbox" id="u-active" ${t.active?"checked":""}> Actif</label></div>`:""} \n    <div class="actions"><button class="btn-o" onclick="closeModal()">Annuler</button>\n    <button class="btn" onclick="saveUser(${t?.id||0})">Enregistrer</button></div>`)
}

function editUser(i) {
    var t = USERS_LIST[i];
    if(t) showUserModal(t)
}

async function saveUser(t) {
    var e = {
            name: $("u-name").value,
            role: $("u-role").value
        },
        a = (t || (e.username = $("u-login").value), $("u-pwd").value);
    if (a && (e.password = a), t) e.active = $("u-active")?.checked ?? !0;
    else if (!a) return void toast("Mot de passe requis", "err");
    try {
        t ? await api("/api/users/" + t, {
            method: "PUT",
            body: JSON.stringify(e)
        }) : await api("/api/users", {
            method: "POST",
            body: JSON.stringify(e)
        }), closeModal(), toast("Utilisateur enregistré", "ok"), loadUsers()
    } catch (t) {
        toast(t.message, "err")
    }
}


/* ══════ SECTION 14 : RAPPORTS ═══════════════════════════════════ */

function initReports() {
    var t = new Date,
        e = new Date;
    e.setDate(e.getDate() - 29), $("rp-from").value = e.toISOString().slice(0, 10), $("rp-to").value = t.toISOString().slice(0, 10), loadReports()
}

async function loadReports() {
    try {
        var t = await api(`/api/reports?from=${$("rp-from").value}&to=` + $("rp-to").value);
        let a = `<div class="grid3 mt-16">\n      <div class="stat-card"><div class="val">${fmt(t.ca)}</div><div class="lbl">CA total</div></div>\n      <div class="stat-card"><div class="val">${t.n}</div><div class="lbl">Commandes</div></div>\n      <div class="stat-card"><div class="val">${fmt(t.avg)}</div><div class="lbl">Panier moyen</div></div>\n      <div class="stat-card"><div class="val">${fmt(t.encaissements)}</div><div class="lbl">Encaissements</div></div>\n      <div class="stat-card"><div class="val">${fmt(t.discounts)}</div><div class="lbl">Remises</div></div>\n      <div class="stat-card"><div class="val">${t.cancelled?.n||0}</div><div class="lbl">Annulées (${fmt(t.cancelled?.v||0)})</div></div>\n    </div>`;
        t.kg && (a += `<p class="mt-8">Kilo : ${t.kg} kg — ${fmt(t.caKilo)}</p>`), a += '<h3 class="mt-16">Par mode de paiement</h3><div class="grid3">', Object.entries(t.byPay || {}).forEach(([t, e]) => {
            a += `<div class="stat-card"><div class="val">${fmt(e)}</div><div class="lbl">${esc(t)}</div></div>`
        }), a += "</div>", t.top && t.top.length && (a += '<h3 class="mt-16">Top articles</h3><table><thead><tr><th>Article</th><th>Qté</th><th class="text-right">CA</th></tr></thead><tbody>', t.top.forEach(t => {
            a += `<tr><td>${esc(t.name)}</td><td>${t.qty}</td><td class="text-right">${fmt(t.ca)}</td></tr>`
        }), a += "</tbody></table>"), t.credits && t.credits.length && (a += `<h3 class="mt-16" style="color:var(--err)">⚠️ Créances en cours (${t.credits.length})</h3>\n        <table><thead><tr><th>Code</th><th>Client</th><th>Total</th><th>Payé</th><th>Dû</th></tr></thead><tbody>`, t.credits.forEach(t => {
            a += `<tr style="cursor:pointer" onclick="showOrder(${t.id})"><td>${esc(t.code)}</td><td>${esc(t.client_name)}</td><td class="text-right">${fmt(t.total)}</td><td class="text-right">${fmt(t.paid_total)}</td><td class="text-right" style="color:var(--err)">${fmt(t.balance)}</td></tr>`
        }), a += "</tbody></table>"), $("report-content").innerHTML = a
    } catch (t) {
        toast(t.message, "err")
    }
}


/* ══════ SECTION 15 : MODAL & ÉCOUTEURS GLOBAUX ══════════════════ */

function showModal(t) {
    $("generic-modal-body").innerHTML = t, $("generic-modal").classList.add("open")
}

function closeModal() {
    $("generic-modal").classList.remove("open")
}

$("os-q").addEventListener("keydown", t => {
    "Enter" === t.key && loadOrders()
});

document.addEventListener("keydown", t => {
    "Escape" === t.key && closeModal()
});
