# Performance tooling

* `seed-large.sql`: bulk-loads synthetic patients, appointments, finalized consultations,
  bills and payments into a **dedicated performance database**. It disables triggers for
  its session (`session_replication_role = replica`), so it needs a superuser and must never
  be run against a real database.
* `benchmark.mjs`: read-only latency benchmark of the busiest endpoints. Prints a Markdown
  table.

See [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md) for the method and the results.
