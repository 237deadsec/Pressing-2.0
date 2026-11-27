# PressingPro (Light Pressing)

Logiciel de caisse et de gestion pour un pressing, utilisé par la boutique Light Pressing à Kribi (Cameroun). Montants en FCFA, paiements en Espèces, Mobile Money ou Crédit.

> ⚠️ **État au 27/11/2026 : une installation neuve ne démarre pas.** Le refactor `ecb27c1` (P3.6) a réécrit le schéma de `src/db.js`, qui ne correspond plus aux routes, et `server.js` appelle `initDB()` sans `hashPwd`. Une base déjà créée par une version antérieure continue de fonctionner. Voir [ROADMAP.md](ROADMAP.md), section « À faire en priorité ».

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

Il n'y a ni tests, ni CI, ni outil de migration : le schéma est créé au démarrage par `initDB()` avec `CREATE TABLE IF NOT EXISTS`.

## Structure

```
server.js            Configuration Express, routes PWA/SPA, démarrage
src/config.js        Constantes, rôles, permissions par défaut
src/db.js            Pool PostgreSQL et initDB() (schéma + données initiales)
src/auth.js          Hachage des mots de passe et jetons de session
src/middleware.js    auth(rôle|permission), anti-bruteforce
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

**Comptes initiaux.** Ils sont créés seulement si la table `users` est vide, et un changement de mot de passe est imposé à la première connexion :

- Code d'avant P3.6 (jusqu'à `81d8261`) : `gerant` / `0000`, `superviseur` / `2345`, `caissier` / `1234`.
- Code actuel (`ecb27c1`) : `admin` / `admin`, mais ce chemin plante aujourd'hui (voir l'avertissement en haut).

Change ces mots de passe immédiatement sur toute installation accessible depuis Internet.

## Déployer sur Vercel

1. Importer le dépôt dans Vercel. `vercel.json` envoie toutes les requêtes vers `server.js` (`@vercel/node`) et embarque `public/**`.
2. Définir `DATABASE_URL` et `SESSION_SECRET` dans Project Settings → Environment Variables (Production et Preview).
3. Déployer. Vérifier ensuite `GET /api/health`, qui doit renvoyer `{"status":"ok"}`.

Limites connues du mode serverless :
- Les permissions personnalisées et le compteur anti-bruteforce sont gardés **en mémoire par instance**. Une modification de permissions peut ne pas être vue par les autres instances, et l'anti-bruteforce est presque inefficace.
- Une erreur SQL dans une route `async` n'est pas interceptée par Express 4 et fait tomber l'instance.
- Les fichiers statiques sont lus en mémoire par `server.js` (contournement de P3.4), pas servis par le CDN.

## Déployer sur un serveur classique

`npm start` suffit derrière un reverse proxy (NGINX, Cloudflare Tunnel). `trust proxy` est déjà configuré pour les adresses locales. La description du paquet mentionne Docker, mais **aucun Dockerfile n'existe** dans le dépôt.

## API utile

- `GET /api/health` : test de connexion à la base, public.
- `GET /api/backup` : export JSON de toutes les tables (permission `backup.create`).

## Feuille de route

Voir [ROADMAP.md](ROADMAP.md).
