import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CreateChamberInput,
  createChamberSchema,
  DeleteWithReasonInput,
  deleteWithReasonSchema,
  paginationQuerySchema,
  PERMISSIONS,
  UpdateChamberInput,
  updateChamberSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { ChamberListQuery, ChambersService } from './chambers.service';

const listQuerySchema = paginationQuerySchema.extend({ organizationId: z.string().uuid().optional() });

@ApiTags('chambers')
@Controller('chambers')
export class ChambersController {
  constructor(private readonly chambers: ChambersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CHAMBERS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(listQuerySchema) query: ChamberListQuery) {
    return this.chambers.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CHAMBERS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.chambers.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CHAMBERS_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(createChamberSchema) body: CreateChamberInput) {
    return this.chambers.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CHAMBERS_UPDATE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(updateChamberSchema) body: UpdateChamberInput,
  ) {
    return this.chambers.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CHAMBERS_DELETE)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(deleteWithReasonSchema) body: DeleteWithReasonInput,
  ) {
    await this.chambers.remove(actor, id, body.reason);
    return { deleted: true };
  }
}
