const SECRET_KEYS = new Set(['passwordHash', 'password', 'newPassword', 'currentPassword', 'tokenHash', 'csrfHash', 'mfaSecretEnc']);

/**
 * Removes secrets from values before they are written to audit logs or
 * returned to clients. Converts Decimal/Date/BigInt into JSON-safe values.
 */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Prisma.Decimal
    if (typeof (obj as { toFixed?: unknown }).toFixed === 'function' && 'd' in obj) return Number(obj.toString());
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = sanitizeForAudit(v);
    }
    return out;
  }
  return value;
}

/** Returns only the keys whose values differ — keeps audit diffs small and readable. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  const b = sanitizeForAudit(before) as Record<string, unknown>;
  const a = sanitizeForAudit(after) as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    if (key === 'updatedAt' || key === 'version') continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      oldValue[key] = b[key] ?? null;
      newValue[key] = a[key] ?? null;
    }
  }
  return { oldValue, newValue };
}
