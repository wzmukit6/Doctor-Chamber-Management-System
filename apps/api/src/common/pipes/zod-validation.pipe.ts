import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ERROR_CODES } from '@chamber/shared';
import { AppError } from '../errors/app-error';

/** Validates and normalizes input with a shared zod schema (API-level validation, spec §38). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Some fields are invalid',
      HttpStatus.UNPROCESSABLE_ENTITY,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}
