import { DEFAULT_PASSWORD_POLICY, passwordIssues, passwordSchema } from '@chamber/shared';

describe('configurable password policy', () => {
  it('default policy', () => {
    expect(passwordIssues('Str0ngPassw0rd')).toEqual([]);
    expect(passwordIssues('short')).toEqual(expect.arrayContaining(['validation.password.min_length', 'validation.password.upper', 'validation.password.digit']));
  });

  it('stricter policy adds length and symbol rules', () => {
    const strict = { ...DEFAULT_PASSWORD_POLICY, passwordMinLength: 16, passwordRequireSymbol: true };
    expect(passwordIssues('Str0ngPassw0rd', strict)).toEqual(['validation.password.min_length', 'validation.password.symbol']);
    expect(passwordIssues('Str0ng!Passw0rd-XY', strict)).toEqual([]);
  });

  it('relaxed policy never goes below the 8-character floor', () => {
    const relaxed = { passwordMinLength: 8, passwordRequireUpper: false, passwordRequireLower: false, passwordRequireDigit: false, passwordRequireSymbol: false };
    expect(passwordIssues('abcdefg', relaxed)).toEqual(['validation.password.min_length']);
    expect(passwordIssues('abcdefgh', relaxed)).toEqual([]);
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(true);
    expect(passwordSchema.safeParse('abc').success).toBe(false);
  });
});
