import { Global, Module } from '@nestjs/common';
import { ComplaintsController, DiagnosesController, InvestigationsController, VitalDefinitionsController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { VitalDefinitionsService } from './vital-definitions.service';

@Global()
@Module({
  controllers: [DiagnosesController, InvestigationsController, ComplaintsController, VitalDefinitionsController],
  providers: [CatalogService, VitalDefinitionsService],
  exports: [CatalogService, VitalDefinitionsService],
})
export class CatalogModule {}
