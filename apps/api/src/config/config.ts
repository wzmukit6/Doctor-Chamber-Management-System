import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().default('http://localhost:5173'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(12),
  COOKIE_SECURE: bool.default(true),
  TRUST_PROXY: bool.default(false),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  PASSWORD_RESET_MINUTES: z.coerce.number().int().min(5).default(30),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
});

export type AppConfig = z.infer<typeof envSchema> & {
  webOrigins: string[];
  isProduction: boolean;
};

let cached: AppConfig | null = null;

/** Parses and validates environment variables once. Fails fast on misconfiguration. */
export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  cached = {
    ...env,
    webOrigins: env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
  return cached;
}

export const SESSION_COOKIE = 'ca_session';
export const CSRF_COOKIE = 'ca_csrf';
export const CSRF_HEADER = 'x-csrf-token';
