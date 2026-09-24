import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { IS_PUBLIC_KEY, SKIP_CSRF_KEY } from '../decorators/auth.decorators';
import { AuthenticatedRequest, requestMeta } from '../request-context';
import { SessionService } from '../../modules/auth/session.service';
import { CSRF_HEADER, SESSION_COOKIE } from '../../config/config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authentication + CSRF guard. Resolves the session cookie into an Actor
 * (identity → role → permissions → tenant scope) on every request and
 * verifies the double-submit CSRF token on state-changing requests.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw AppError.unauthenticated();

    const { actor, csrfHash } = await this.sessions.resolve(token, requestMeta(req));

    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets);
    if (!SAFE_METHODS.has(req.method) && !skipCsrf) {
      const header = req.headers[CSRF_HEADER];
      if (!this.sessions.verifyCsrf(csrfHash, typeof header === 'string' ? header : undefined)) {
        throw new AppError('CSRF_INVALID', 'Security token missing or invalid. Please reload the page.', 403);
      }
    }

    req.actor = actor;
    return true;
  }
}
