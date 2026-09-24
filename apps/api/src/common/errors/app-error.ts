import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, ErrorCode } from '@chamber/shared';

/**
 * Domain/application error. Thrown from services; translated into the
 * structured `{ success: false, error: { code, message } }` response by the
 * global exception filter. Messages are safe to show to end users.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: { path: string; message: string }[],
    public readonly data?: unknown,
  ) {
    super(message);
  }

  static notFound(resource = 'Resource') {
    return new AppError(ERROR_CODES.NOT_FOUND, `${resource} not found`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static crossTenant() {
    // Deliberately indistinguishable from "not found" to avoid leaking existence.
    return new AppError(ERROR_CODES.NOT_FOUND, 'Resource not found', HttpStatus.NOT_FOUND);
  }

  static staleVersion() {
    return new AppError(
      ERROR_CODES.STALE_VERSION,
      'This record was changed by someone else. Reload and try again.',
      HttpStatus.CONFLICT,
    );
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
}
