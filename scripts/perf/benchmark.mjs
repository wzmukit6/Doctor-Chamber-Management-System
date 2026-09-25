#!/usr/bin/env node
/**
 * API latency benchmark (spec §44). Signs in as the demo users and measures
 * the endpoints behind the busiest screens against a large dataset.
 *
 *   PERF_API=http://localhost:4100/api node scripts/perf/benchmark.mjs [runs]
 *
 * Prints a Markdown table (p50 / p95 / max in ms). Read-only: no data is changed.
 */
const API = process.env.PERF_API ?? 'http://localhost:4100/api';
const PASSWORD = process.env.PERF_PASSWORD ?? 'Demo@12345';
const RUNS = Number(process.argv[2] ?? 20);
const WARMUP = 3;

async function login(email) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return (path) => fetch(`${API}${path}`, { headers: { cookie } });
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const manager = await login('manager@demo.chamber.local');
const doctor = await login('doctor@demo.chamber.local');

const firstPatient = (await (await manager('/patients?pageSize=1&q=Karim')).json()).data?.[0]?.id;
const year = `from=${shift(today, -365)}&to=${today}`;
const month = `from=${shift(today, -29)}&to=${today}`;

const cases = [
  ['Patient search — name', manager, '/patients/search?q=Nasrin%20Akter'],
  ['Patient search — typo', manager, '/patients/search?q=Nasrn%20Aktr'],
  ['Patient search — phone fragment', manager, '/patients/search?q=01712'],
  ['Patient search — patient ID', manager, '/patients/search?q=PF-0054321'],
  ['Patient list (page 1)', manager, '/patients?page=1&pageSize=25'],
  ['Patient list (page 2000)', manager, '/patients?page=2000&pageSize=25'],
  ['Patient profile', manager, `/patients/${firstPatient}`],
  ['Patient timeline', doctor, `/patients/${firstPatient}/timeline`],
  ['Appointments — day', manager, `/appointments?from=${today}&to=${today}`],
  ['Appointments — week', manager, `/appointments?from=${shift(today, -6)}&to=${today}`],
  ['Queue', manager, '/queue'],
  ['Consultations list', doctor, '/consultations?page=1&pageSize=25'],
  ['Medicine search (Rx builder)', doctor, '/medicines?q=parac&limit=10'],
  ['Diagnosis search', doctor, '/diagnoses?q=hypert&limit=10'],
  ['Bills list', manager, '/invoices?page=1&pageSize=25'],
  ['Collections summary — 30 days', manager, `/invoices/summary?${month}`],
  ['Dashboard analytics — 30 days', manager, '/reports/dashboard?days=30'],
  ['Dashboard analytics — 90 days', manager, '/reports/dashboard?days=90'],
  ['Report: daily revenue — 1 year', manager, `/reports/revenue-daily?${year}`],
  ['Report: appointments by day — 1 year', manager, `/reports/appointments-daily?${year}`],
  ['Report: patients seen — 1 year', manager, `/reports/patients-seen?${year}`],
  ['Report: top diagnoses — 1 year', manager, `/reports/diagnosis-stats?${year}`],
  ['Report: patient list — 1 year (5,000 rows)', manager, `/reports/patient-list?${year}`],
  ['Report: consultation list — 30 days', manager, `/reports/consultation-list?${month}`],
  ['Audit log (page 1)', manager, '/audit-logs?page=1&pageSize=25'],
];

const rows = [];
for (const [name, call, path] of cases) {
  const times = [];
  let status = 0;
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const t0 = performance.now();
    const res = await call(path);
    await res.arrayBuffer();
    status = res.status;
    if (i >= WARMUP) times.push(performance.now() - t0);
  }
  rows.push({ name, status, p50: pct(times, 50), p95: pct(times, 95), max: Math.max(...times) });
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(`| Endpoint | Status | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.name} | ${r.status} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.max.toFixed(0)} |`);
