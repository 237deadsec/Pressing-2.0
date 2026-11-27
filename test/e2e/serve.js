'use strict';
// Serveur des tests navigateur : recrée une base jetable, puis lance l'application.
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:e2e
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB_NAME = 'pressing_e2e';

(async () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + DB_NAME;
  Object.assign(process.env, {
    DATABASE_URL: u.toString(),
    PORT: process.env.E2E_PORT || '3901',
    SESSION_SECRET: 'e2e-secret',
    VERCEL: '', VERCEL_ENV: '', NODE_ENV: '', INITIAL_ADMIN_PASSWORD: '',
  });
  require('../../server.js');
})().catch((e) => { console.error(e); process.exit(1); });
