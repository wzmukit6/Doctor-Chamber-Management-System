// Loads apps/api/.env for local development. Must be the first import in main.ts
// because several modules read configuration at import time.
// Real deployments inject environment variables / secrets instead.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — rely on the process environment */
}
