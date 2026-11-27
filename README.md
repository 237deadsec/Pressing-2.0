# PressingPro (Light Pressing)

Logiciel de caisse et de gestion pour un pressing, utilisé par la boutique Light Pressing à Kribi (Cameroun). Montants en FCFA, paiements en Espèces, Mobile Money ou Crédit.

## Ce que fait l'application

- **Commandes** à l'article (tarif normal ou express) ou au kilo, remises motivées, cycle `déposé → traitement → prêt → livré` (ou annulé). Facture numérotée à la livraison.
- **Paiements** partiels, acomptes et **créances** (ventes à crédit).
- **Clients**, **abonnements** (forfaits de N articles), **catalogue** par catégorie avec historique des prix.
- **Statistiques**, rapports CSV ou imprimables, alertes de commandes en retard.
- **Journal d'activité**, sauvegarde JSON, paramètres (logo, format de facture).
- **Rôles** `caissier`, `superviseur`, `gerant`, avec permissions fines par module (modifiables par le gérant).
- **Page publique de suivi** pour le client : `/suivi/:token`.
- **PWA** installable avec page hors ligne.

## Stack

| Élément | Choix |
|---|---|
| Serveur | Node.js ≥ 18, Express 4 |
| Base | PostgreSQL (Supabase en production d'après l'historique) via `pg` |
| Front | SPA en JavaScript pur dans `public/`, sans framework ni étape de build |
| Auth | Mots de passe scrypt, cookie HttpOnly signé HMAC, valable 12 h |
| Hébergement | Vercel (fonction serverless, voir `vercel.json`) |

Il n'y a pas d'outil de migration : le schéma est créé ou complété au démarrage par `initDB()` (`src/db.js`). Un test de fumée (`test/smoke.test.js`) tourne en CI sur PostgreSQL 16, sur une base vierge et sur une copie du schéma de production.

## Structure

```
server.js            Configuration Express, routes PWA/SPA, démarrage
src/config.js        Constantes, rôles, permissions par défaut
src/db.js            Pool PostgreSQL et initDB() (schéma + données initiales)
src/auth.js          Hachage des mots de passe et jetons de session
src/middleware.js    auth(rôle|permission), IP du client
src/loginAttempts.js Anti-bruteforce stocké en base
src/helpers.js       Paramètres, journal, numérotation commandes et factures
src/routes/*.js      15 routeurs (orders, payments, clients, catalog, ...)
public/              SPA (index.html, app.js), suivi.html, service worker, manifest
```

## Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | **Oui** | Chaîne de connexion PostgreSQL. Le processus s'arrête si elle manque. SSL activé automatiquement si l'URL contient `supabase` ou `sslmode=require`. |
| `SESSION_SECRET` | **Oui en pratique** | Clé de signature des cookies de session. Si elle manque, une valeur aléatoire est générée à chaque démarrage : toutes les sessions sont perdues au redémarrage, et sur Vercel chaque instance a son propre secret (déconnexions aléatoires). Générer avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `PORT` | Non | Port d'écoute en local. Défaut `3000`. Ignoré sur Vercel. |
| `VERCEL` | Non | Définie automatiquement par Vercel. Si présente, l'app est exportée au lieu d'écouter sur un port, et le schéma est initialisé à la première requête `/api`. |

Aucun fichier `.env` n'est chargé automatiquement (pas de `dotenv`). En local, exporte les variables dans le shell ou utilise `node --env-file=.env server.js` (Node ≥ 20.6).

## Lancer en local

```bash
npm install
export DATABASE_URL="postgres://user:motdepasse@localhost:5432/pressing"
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
npm run dev        # redémarre à chaque modification (node --watch)
# ou
npm start
```

Puis ouvrir http://localhost:3000. Le serveur affiche aussi son adresse sur le réseau local, pour les postes de caisse de la boutique.

**Comptes initiaux.** Ils sont créés seulement si la table `users` est vide : `gerant` / `0000`, `superviseur` / `2345`, `caissier` / `1234`. Un changement de mot de passe est imposé à la première connexion. Fais-le immédiatement sur toute installation accessible depuis Internet.

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

`TEST_DATABASE_URL` doit pointer vers une base d'administration : chaque scénario crée puis supprime sa propre base jetable. La CI GitHub Actions (`.github/workflows/ci.yml`) lance le même test.

## Déployer sur Vercel

1. Importer le dépôt dans Vercel. `vercel.json` envoie toutes les requêtes vers `server.js` (`@vercel/node`) et embarque `public/**`.
2. Définir `DATABASE_URL` et `SESSION_SECRET` dans Project Settings → Environment Variables (Production et Preview).
3. Déployer. Attention : au premier appel `/api`, `initDB()` complète le schéma de la base visée. Un déploiement Preview qui partage le `DATABASE_URL` de production modifie donc la base de production. Vérifier ensuite `GET /api/health`, qui doit renvoyer `{"status":"ok"}`.

Limites connues du mode serverless :
- Les permissions personnalisées sont relues en base au plus toutes les 10 secondes par instance (`PERMISSIONS_TTL_MS`) : une modification met jusqu'à 10 s à s'appliquer partout.
- L'anti-bruteforce (5 échecs en 15 min → blocage 5 min, par IP et par nom d'utilisateur) est stocké dans la table `login_attempts`, partagée par toutes les instances. Sur Vercel, l'IP vient de l'en-tête `x-vercel-forwarded-for`.
- `initDB()` tourne à chaque démarrage à froid, mais ne lance aucun DDL quand le schéma est à jour. En production, le rôle applicatif doit être propriétaire de toutes les tables du schéma `public` (sinon tout `ALTER TABLE` échoue).
- Les fichiers statiques sont lus en mémoire par `server.js` (contournement de P3.4), pas servis par le CDN.

## Déployer sur un serveur classique

`npm start` suffit derrière un reverse proxy (NGINX, Cloudflare Tunnel). `trust proxy` est déjà configuré pour les adresses locales. La description du paquet mentionne Docker, mais **aucun Dockerfile n'existe** dans le dépôt.

## API utile

- `GET /api/health` : test de connexion à la base, public.
- `GET /api/backup` : export JSON de toutes les tables (permission `backup.create`).

## Feuille de route

Voir [ROADMAP.md](ROADMAP.md).
