import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { dashboardQuerySchema, EXPORT_FORMATS, PERMISSIONS, ReportQuery, reportQuerySchema } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { ReportsService } from './reports.service';

const exportQuerySchema = z.intersection(reportQuerySchema, z.object({ format: z.enum(EXPORT_FORMATS).default('csv'), lang: z.enum(['en', 'bn']).default('en') }));

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Reports the current user may run (filtered by permission). */
  @Get()
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  catalog(@CurrentActor() actor: Actor) {
    return this.reports.catalog(actor);
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  dashboard(@CurrentActor() actor: Actor, @ValidQuery(dashboardQuerySchema) q: z.infer<typeof dashboardQuerySchema>) {
    return this.reports.dashboard(actor, q.days);
  }

  @Get(':key')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  run(@CurrentActor() actor: Actor, @Param('key') key: string, @ValidQuery(reportQuerySchema) q: ReportQuery) {
    return this.reports.run(actor, key, q);
  }

  /** File download (CSV or Excel); PDF is produced from the print view in the browser. */
  @Get(':key/export')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT)
  async export(@CurrentActor() actor: Actor, @Param('key') key: string, @ValidQuery(exportQuerySchema) q: z.infer<typeof exportQuerySchema>, @Res() res: Response) {
    const file = await this.reports.export(actor, key, q, q.format, q.lang);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  }
}
