#!/usr/bin/env node
/**
 * One-time local setup:  npm run setup
 *
 *  1. checks Node.js (20+)
 *  2. creates apps/api/.env from .env.example (if missing)
 *  3. installs dependencies
 *  4. starts PostgreSQL with Docker (docker compose up -d db) when Docker is
 *     available — otherwise uses the PostgreSQL in DATABASE_URL
 *  5. builds the shared package, applies migrations, loads demo data
 *
 *     (pass --no-docker to always use your own PostgreSQL)
 * Safe to run again: nothing is deleted, migrations and the seed are idempotent.
 * Afterwards start the app with:  npm run dev
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const fail = (msg) => {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
};
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: opts.quiet ? 'pipe' : 'inherit', shell: isWin, ...opts });
  return r.status === 0;
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) fail(`Node.js 20 or newer is required (found ${process.version}). Install it from https://nodejs.org`);

step('Environment file');
const env = join(root, 'apps/api/.env');
if (!existsSync(env)) {
  copyFileSync(join(root, 'apps/api/.env.example'), env);
  console.log('created apps/api/.env from .env.example');
} else console.log('apps/api/.env already exists — keeping it');

step('Installing dependencies (npm install)');
if (!run('npm', ['install', '--no-audit', '--no-fund'])) fail('npm install failed');

step('Database');
const hasDocker = !process.argv.includes('--no-docker') && run('docker', ['compose', 'version'], { quiet: true });
if (hasDocker) {
  if (!run('docker', ['compose', 'up', '-d', 'db'])) fail('Could not start the database container. Is Docker Desktop running?');
  process.stdout.write('waiting for PostgreSQL');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = run('docker', ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', 'chamber', '-d', 'chamber_dev'], { quiet: true });
    if (!ready) {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(ready ? ' ready' : '');
  if (!ready) fail('PostgreSQL did not become ready within 60 s (docker compose logs db)');
} else {
  console.log('Docker not found — using the PostgreSQL server configured in apps/api/.env (DATABASE_URL).');
  console.log('It must be running and the user must be allowed to create the database.');
}

step('Building the shared package');
if (!run('npm', ['run', 'build:shared'])) fail('build:shared failed');

step('Creating tables (prisma migrate deploy)');
if (!run('npx', ['prisma', 'migrate', 'deploy'], { cwd: join(root, 'apps/api') }))
  fail('Migrations failed — check that PostgreSQL is running and DATABASE_URL in apps/api/.env is correct');

step('Loading demo data (npm run db:seed)');
if (!run('npm', ['run', 'db:seed'])) fail('Seeding failed');

console.log(`
\x1b[32m✔ Setup complete.\x1b[0m

Start the app:   npm run dev
Then open:       http://localhost:5173
Demo password:   Demo@12345  (doctor@demo.chamber.local, manager@…, assistant@…, superadmin@…)
`);
