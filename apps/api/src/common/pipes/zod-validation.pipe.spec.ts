import { createUserSchema, loginSchema, passwordIssues } from '@chamber/shared';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe + shared schemas', () => {
  it('normalizes valid input', () => {
    const pipe = new ZodValidationPipe(loginSchema);
    expect(pipe.transform({ email: '  Doctor@Example.COM ', password: 'x' })).toEqual({
      email: 'doctor@example.com',
      password: 'x',
    });
  });

  it('raises VALIDATION_FAILED with field details', () => {
    const pipe = new ZodValidationPipe(createUserSchema);
    try {
      pipe.transform({ fullName: '', email: 'bad', password: 'short', role: 'HACKER', phone: '12' });
      fail('expected error');
    } catch (err) {
      const e = err as { code: string; details: { path: string }[] };
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.details.map((d) => d.path)).toEqual(expect.arrayContaining(['fullName', 'email', 'password', 'role', 'phone']));
    }
  });

  it('enforces the password policy', () => {
    expect(passwordIssues('Str0ngPassw0rd')).toEqual([]);
    expect(passwordIssues('short')).toEqual(
      expect.arrayContaining(['validation.password.min_length', 'validation.password.upper', 'validation.password.digit']),
    );
  });

  it('accepts Bangladeshi and international phone formats', () => {
    const pipe = new ZodValidationPipe(createUserSchema.pick({ phone: true }));
    expect(pipe.transform({ phone: '01711-000 000' })).toEqual({ phone: '01711000000' });
    expect(pipe.transform({ phone: '+8801711000000' })).toEqual({ phone: '+8801711000000' });
  });
});
