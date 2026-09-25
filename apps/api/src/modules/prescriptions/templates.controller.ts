import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, PrescriptionTemplateInput, prescriptionTemplateSchema, UpdatePrescriptionTemplateInput, updatePrescriptionTemplateSchema } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { TemplatesService } from './templates.service';

@ApiTags('prescriptions')
@Controller('prescription-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  list(@CurrentActor() actor: Actor) {
    return this.templates.list(actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(prescriptionTemplateSchema) body: PrescriptionTemplateInput) {
    return this.templates.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(updatePrescriptionTemplateSchema) body: UpdatePrescriptionTemplateInput) {
    return this.templates.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(actor, id);
  }
}
