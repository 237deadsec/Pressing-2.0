'use strict';
// Anti-bruteforce des connexions, stocké en base.
//
// Avant, les compteurs étaient dans une Map en mémoire : sur Vercel, chaque
// instance avait les siens, et une nouvelle instance repartait de zéro.
// Ils sont maintenant dans la table login_attempts, partagée par toutes les
// instances.
//
// Règle (inchangée) : 5 échecs → blocage de 5 minutes, pour l'adresse IP et
// pour le nom d'utilisateur. Nouveauté : les échecs plus vieux que
// WINDOW_MIN minutes ne comptent plus.

const { q, q1 } = require('./db');

const MAX_FAILS = 5;
const BLOCK_MIN = 5;
const WINDOW_MIN = 15;

const keysFor = (ip, username) => {
  const keys = ['ip:' + ip];
  if (username) keys.push('u:' + username.toLowerCase());
  return keys;
};

// Renvoie true si l'IP ou le nom d'utilisateur est bloqué en ce moment.
async function isBlocked(ip, username) {
  const r = await q1(
    'SELECT 1 FROM login_attempts WHERE key = ANY($1) AND blocked_until > now() LIMIT 1',
    [keysFor(ip, username)]
  );
  return !!r;
}

// Compte un échec. Une seule requête atomique par clé : deux instances qui
// comptent en même temps ne perdent pas d'échec.
async function recordFailure(ip, username) {
  for (const key of keysFor(ip, username)) {
    // n = échecs récents déjà comptés (remis à 0 hors de la fenêtre).
    const n = '(CASE WHEN login_attempts.updated_at < now() - make_interval(mins => $4::int) THEN 0 ELSE login_attempts.fails END)';
    await q(`
      INSERT INTO login_attempts(key, fails, blocked_until, updated_at)
      VALUES ($1, 1, NULL, now())
      ON CONFLICT (key) DO UPDATE SET
        fails = CASE WHEN ${n} + 1 >= $2 THEN 0 ELSE ${n} + 1 END,
        blocked_until = CASE WHEN ${n} + 1 >= $2 THEN now() + make_interval(mins => $3::int)
                             ELSE login_attempts.blocked_until END,
        updated_at = now()`,
      [key, MAX_FAILS, BLOCK_MIN, WINDOW_MIN]);
  }
  // Ménage : la table reste minuscule.
  await q("DELETE FROM login_attempts WHERE updated_at < now() - interval '1 day' AND (blocked_until IS NULL OR blocked_until < now())");
}

async function clearFailures(ip, username) {
  await q('DELETE FROM login_attempts WHERE key = ANY($1)', [keysFor(ip, username)]);
}

module.exports = { isBlocked, recordFailure, clearFailures, MAX_FAILS };
