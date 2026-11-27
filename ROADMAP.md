# Feuille de route

Le plan d'origine (numéros P0 à P3) n'a jamais été versionné. Ce document le **reconstitue à partir des messages de commit** du 14 au 23 novembre 2026. Légende :

- ✅ fait, avec le commit qui le prouve
- ⚠️ fait, mais cassé ou incomplet
- **[supposé]** : déduction, pas de preuve dans le dépôt. À confirmer ou corriger.

Les intitulés de phase (« Fondations », etc.) sont aussi **[supposés]** : seuls les numéros apparaissent dans les commits.

## P0 : Fondations et sécurité [intitulé supposé]

| # | Élément | État | Preuve |
|---|---|---|---|
| P0.1 | Récupérer le code de production depuis le déploiement Vercel **[supposé]** | ✅ | `6f7e20d` (non numéroté) |
| P0.2 | Rendre `app.js` lisible (déminifié, découpé en 15 sections) **[supposé]** | ✅ | `61af231` (non numéroté) |
| P0.3 | Corriger les failles XSS (`esc()` sur tout `innerHTML`) **[supposé]** | ✅ | `171c640` (non numéroté) |
| P0.4 | Standardiser les rôles `caissier` / `superviseur` / `gerant` (base + front) | ✅ | `1c1e8bc` |

P0.1 à P0.3 ne portent pas de numéro. On les rattache à P0 parce que ce sont les trois premiers commits et qu'ils relèvent des fondations. P0.4 a été livré **après** P2.5, donc l'ordre de livraison ne suivait pas l'ordre des numéros.

## P1 : Gestion quotidienne de la boutique [intitulé supposé]

| # | Élément | État | Preuve |
|---|---|---|---|
| P1.1 | Refonte visuelle « glassmorphism », thème sombre **[supposé]** | ✅ | `437fca0` (non numéroté) |
| P1.2 | Module clients complet (fiche, historique, édition, création, doublons) | ✅ | `1cb6997`, `5d11ce2` |
| P1.3 | Vue dédiée des créances, paiement rapide des plus anciennes | ✅ | `7711796` |
| P1.4 | Optimisation mobile (points de rupture 600 et 400 px) | ✅ | `5670159` |
| P1.5 | Alertes de commandes en retard sur le tableau de bord | ✅ | `5670159` |

P1.1 est la supposition la plus fragile : la refonte visuelle n'est pas numérotée et pourrait aussi bien être hors plan.

## P2 : Fonctions métier [intitulé supposé]

| # | Élément | État | Preuve |
|---|---|---|---|
| P2.1 | Catalogue groupé par catégorie | ✅ | `dec6955` |
| P2.2 | Abonnements (forfaits de N articles) | ✅ | `1ee5b56` |
| P2.3 | Export des rapports en CSV et impression | ✅ | `6ab45d1` |
| P2.4 | Journal d'activité (14 actions tracées) | ✅ | `d062936` |
| P2.5 | Modifier une commande après création (statut « déposé » seulement) | ✅ | `22d53c6` |

## P3 : Fonctions avancées et qualité [intitulé supposé]

| # | Élément | État | Preuve |
|---|---|---|---|
| P3.1 | Historique des prix du catalogue | ✅ | `d19de32`, cassé jusqu'au correctif `122ab0e` (PR #1) qui crée correctement `price_history`. |
| P3.2 | Permissions fines par module (23 clés, écran d'administration) | ✅ | `5fa4575`. Sur Vercel, les permissions sont relues en base toutes les 10 s par instance depuis le correctif Vercel (PR #5). |
| P3.3 | Mode sombre amélioré (contrastes) | ✅ | `2a24434` |
| P3.4 | PWA : manifest, service worker, page hors ligne | ✅ | `89b54aa` puis 5 correctifs Vercel (`ce1f78d` à `81d8261`) |
| P3.5 | Animations et micro-interactions | ✅ | `286d194` |
| P3.6 | Découper `server.js` en modules `src/` | ✅ | `ecb27c1`, qui avait cassé le schéma et l'authentification des paramètres. Réparé par `122ab0e` (PR #1). |

## Après P3 : inconnu

Rien dans le dépôt ne dit ce qui était prévu ensuite (P3.7 ? P4 ?). **À compléter par Obam.**

## À faire en priorité (proposé, hors plan d'origine)

Ces éléments viennent de l'état des lieux du 27/11/2026, pas du plan d'origine. Ils sont classés par risque.

1. ~~Réparer P3.6~~ : fait dans la PR #1 (schéma restauré, `price_history`, erreurs `async` interceptées).
2. ~~Test de fumée sur un vrai PostgreSQL en CI~~ : fait dans la PR #1.
3. ~~Décider de l'hébergement~~ : Obam garde Vercel (27/11/2026). Permissions et anti-bruteforce sont en base (PR #5). `SESSION_SECRET` est obligatoire en production.
4. ~~Numérotation des commandes et factures dans la transaction~~ : fait (réinstallation du 27/11/2026), avec aussi : permissions fines appliquées côté serveur, mot de passe initial imposé côté serveur, `SESSION_SECRET` obligatoire, fuseau Africa/Douala, RLS sur toutes les tables, sauvegarde JSON complète, encaissements et abonnements protégés contre les doubles saisies simultanées.
5. **Idée à valider** : SMS ou WhatsApp automatique avec le lien de suivi quand une commande passe à « prêt ».
