#!/usr/bin/env node
/**
 * Starts the API (http://localhost:4000) and the web app (http://localhost:5173)
 * together with prefixed output. Ctrl+C stops both.  Usage: npm run dev
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const procs = [
  { name: 'api', color: '\x1b[35m', args: ['run', 'dev:api'] },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev:web'] },
].map(({ name, color, args }) => {
  const child = spawn('npm', args, { cwd: root, shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited (${code ?? 'signal'})`);
    stop(code ?? 0);
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
console.log('Starting API on http://localhost:4000 and web app on http://localhost:5173 — Ctrl+C to stop');
