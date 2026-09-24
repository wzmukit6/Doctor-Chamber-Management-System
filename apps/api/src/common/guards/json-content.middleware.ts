import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Requires `Content-Type: application/json` on requests with a body. Plain
 * HTML forms cannot send JSON cross-site without a CORS preflight, which
 * adds a layer of CSRF protection on top of the double-submit token.
 */
@Injectable()
export class JsonContentMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding'];
    if (BODY_METHODS.has(req.method) && hasBody && !req.is('application/json')) {
      res.status(415).json({
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'Content-Type must be application/json' },
      });
      return;
    }
    next();
  }
}
