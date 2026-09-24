import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateOrganizationInput,
  createOrganizationSchema,
  DeleteWithReasonInput,
  deleteWithReasonSchema,
  PaginationQuery,
  paginationQuerySchema,
  PERMISSIONS,
  UpdateOrganizationInput,
  updateOrganizationSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORGANIZATIONS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(paginationQuerySchema) query: PaginationQuery) {
    return this.orgs.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORGANIZATIONS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORGANIZATIONS_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(createOrganizationSchema) body: CreateOrganizationInput) {
    return this.orgs.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORGANIZATIONS_MANAGE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(updateOrganizationSchema) body: UpdateOrganizationInput,
  ) {
    return this.orgs.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ORGANIZATIONS_MANAGE)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(deleteWithReasonSchema) body: DeleteWithReasonInput,
  ) {
    await this.orgs.remove(actor, id, body.reason);
    return { deleted: true };
  }
}
