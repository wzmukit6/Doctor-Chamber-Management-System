import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiFailure, ERROR_CODES, ErrorCode } from '@chamber/shared';
import { AppError } from '../errors/app-error';

/**
 * Centralized error handling (spec §37). Every error leaves the API in the
 * same structured shape. Stack traces and database internals are logged
 * server-side only — never sent to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) {
      const req = host.switchToHttp().getRequest();
      this.logger.error(
        `${req.method} ${req.path} failed: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiFailure } {
    if (exception instanceof AppError) {
      return fail(exception.status, exception.code, exception.message, exception.details, exception.data);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return fail(HttpStatus.CONFLICT, ERROR_CODES.DUPLICATE, 'A record with the same unique value already exists');
      }
      if (exception.code === 'P2025') {
        return fail(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Resource not found');
      }
      if (exception.code === 'P2003') {
        return fail(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, 'Related record constraint violated');
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === HttpStatus.TOO_MANY_REQUESTS
          ? ERROR_CODES.RATE_LIMITED
          : status === HttpStatus.NOT_FOUND
            ? ERROR_CODES.NOT_FOUND
            : status === HttpStatus.UNAUTHORIZED
              ? ERROR_CODES.UNAUTHENTICATED
              : status === HttpStatus.FORBIDDEN
                ? ERROR_CODES.FORBIDDEN
                : status >= 500
                  ? ERROR_CODES.INTERNAL_ERROR
                  : ERROR_CODES.VALIDATION_FAILED;
      const message =
        status === HttpStatus.TOO_MANY_REQUESTS
          ? 'Too many requests. Please wait and try again.'
          : status >= 500
            ? 'An unexpected error occurred'
            : exception.message;
      return fail(status, code, message);
    }

    // body-parser errors (malformed JSON, payload too large) carry a 4xx status.
    const parserStatus = (exception as { status?: unknown; type?: unknown } | null)?.status;
    if (typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500 && typeof (exception as { type?: unknown }).type === 'string') {
      return fail(
        parserStatus,
        ERROR_CODES.VALIDATION_FAILED,
        parserStatus === HttpStatus.PAYLOAD_TOO_LARGE ? 'Request body is too large' : 'Malformed request body',
      );
    }

    return fail(HttpStatus.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred');
  }
}

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  details?: { path: string; message: string }[],
  data?: unknown,
): { status: number; body: ApiFailure } {
  return {
    status,
    body: { success: false, error: { code, message, ...(details ? { details } : {}), ...(data !== undefined ? { data } : {}) } },
  };
}
