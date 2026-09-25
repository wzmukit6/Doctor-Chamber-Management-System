import { Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_GROUPS, PERMISSIONS, UpdateRolePermissionsInput, updateRolePermissionsSchema } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  list() {
    return this.roles.list();
  }

  @Get('permission-groups')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  groups() {
    return PERMISSION_GROUPS;
  }

  @Put(':id/permissions')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(updateRolePermissionsSchema) body: UpdateRolePermissionsInput,
  ) {
    return this.roles.updatePermissions(actor, id, body);
  }
}
