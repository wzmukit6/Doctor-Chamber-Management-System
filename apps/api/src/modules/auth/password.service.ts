import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ERROR_CODES, passwordIssues } from '@chamber/shared';
import { AppError } from '../../common/errors/app-error';

/** OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Burns comparable CPU time for unknown accounts so response timing does not reveal which emails exist. */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalization');
    await this.verify(await this.dummyHash, password);
  }

  assertStrong(password: string) {
    const issues = passwordIssues(password);
    if (issues.length) {
      throw new AppError(
        ERROR_CODES.WEAK_PASSWORD,
        'Password does not meet the password policy',
        422,
        issues.map((message) => ({ path: 'newPassword', message })),
      );
    }
  }
}
