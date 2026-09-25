import { Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ChangePasswordInput,
  changePasswordSchema,
  ForgotPasswordInput,
  forgotPasswordSchema,
  LoginInput,
  loginSchema,
  ResetPasswordInput,
  resetPasswordSchema,
  SwitchChamberInput,
  switchChamberSchema,
  UpdateProfileInput,
  updateProfileSchema,
} from '@chamber/shared';
import { CurrentActor, Public, SkipCsrf } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import { Actor, requestMeta } from '../../common/request-context';
import { loadConfig } from '../../config/config';
import { SecuritySettingsService } from '../settings/security-settings.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const config = loadConfig();

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly security: SecuritySettingsService,
  ) {}

  /** The active password policy, so forms can show and pre-check it (the server always re-checks). */
  @Public()
  @Get('password-policy')
  async passwordPolicy() {
    const s = await this.security.current();
    return {
      passwordMinLength: s.passwordMinLength,
      passwordRequireUpper: s.passwordRequireUpper,
      passwordRequireLower: s.passwordRequireLower,
      passwordRequireDigit: s.passwordRequireDigit,
      passwordRequireSymbol: s.passwordRequireSymbol,
    };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: config.LOGIN_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@ValidBody(loginSchema) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(body, requestMeta(req));
    this.sessions.setCookies(res, session);
    return { csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  @ApiCookieAuth('session')
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor);
    this.sessions.clearCookies(res);
    return { loggedOut: true };
  }

  @ApiCookieAuth('session')
  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.currentUser(actor);
  }

  @ApiCookieAuth('session')
  @Patch('profile')
  updateProfile(@CurrentActor() actor: Actor, @ValidBody(updateProfileSchema) body: UpdateProfileInput) {
    return this.auth.updateProfile(actor, body);
  }

  @ApiCookieAuth('session')
  @Post('switch-chamber')
  @HttpCode(200)
  async switchChamber(
    @CurrentActor() actor: Actor,
    @ValidBody(switchChamberSchema) body: SwitchChamberInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.switchMembership(actor, body.membershipId, requestMeta(req));
    this.sessions.setCookies(res, session);
    return { csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  @ApiCookieAuth('session')
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentActor() actor: Actor, @ValidBody(changePasswordSchema) body: ChangePasswordInput) {
    await this.auth.changePassword(actor, body);
    return { changed: true };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@ValidBody(forgotPasswordSchema) body: ForgotPasswordInput, @Req() req: Request) {
    // Not awaited: the response time must not reveal whether the account exists.
    this.auth.forgotPassword(body, requestMeta(req)).catch((err: unknown) => this.logger.error(`forgot-password failed: ${err instanceof Error ? err.message : String(err)}`));
    return { message: 'If an account exists for this email, a reset link has been sent.' };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@ValidBody(resetPasswordSchema) body: ResetPasswordInput, @Req() req: Request) {
    await this.auth.resetPassword(body, requestMeta(req));
    return { reset: true };
  }

  @ApiCookieAuth('session')
  @Get('sessions')
  listSessions(@CurrentActor() actor: Actor) {
    return this.auth.listSessions(actor);
  }

  @ApiCookieAuth('session')
  @Delete('sessions/:id')
  async revokeSession(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(actor, id);
    return { revoked: true };
  }
}
