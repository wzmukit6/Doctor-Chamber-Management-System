import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AdminResetPasswordInput,
  adminResetPasswordSchema,
  CreateUserInput,
  createUserSchema,
  DeleteWithReasonInput,
  deleteWithReasonSchema,
  paginationQuerySchema,
  PERMISSIONS,
  SetUserStatusInput,
  setUserStatusSchema,
  UpdateUserInput,
  updateUserSchema,
  userListQuerySchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { UserListQuery, UsersService } from './users.service';

const listQuerySchema = paginationQuerySchema.extend(userListQuerySchema.shape);

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(listQuerySchema) query: UserListQuery) {
    return this.users.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(createUserSchema) body: CreateUserInput) {
    return this.users.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(updateUserSchema) body: UpdateUserInput,
  ) {
    return this.users.update(actor, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  setStatus(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(setUserStatusSchema) body: SetUserStatusInput,
  ) {
    return this.users.setStatus(actor, id, body);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  async resetPassword(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(adminResetPasswordSchema) body: AdminResetPasswordInput,
  ) {
    await this.users.resetPassword(actor, id, body);
    return { reset: true };
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  unlock(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(actor, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USERS_DELETE)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(deleteWithReasonSchema) body: DeleteWithReasonInput,
  ) {
    await this.users.remove(actor, id, body.reason);
    return { deleted: true };
  }
}
