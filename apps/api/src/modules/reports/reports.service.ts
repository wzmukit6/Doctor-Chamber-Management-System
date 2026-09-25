import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  DashboardAnalyticsDto,
  ERROR_CODES,
  PERMISSIONS,
  ReportCatalogEntryDto,
  ReportQuery,
  ReportResultDto,
  addDays,
  zonedDate,
  zonedDayRange,
  type ExportFormat,
  type ReportKey,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { REPORTS, REPORTS_BY_KEY, ROW_LIMIT, type ReportContext, type ReportDefinition } from './report-definitions';

const DEFAULT_TZ = 'Asia/Dhaka';

/**
 * Role-specific reports (spec §19) and exports (spec §59). Every report runs
 * inside the actor's tenant: their active chamber, or (platform administrators
 * without a chamber) all chambers. Doctors always see their own data only
 * ("Reports: Doctor — personal", spec §50). Exports are audited.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private allowed(actor: Actor, def: ReportDefinition) {
    return actor.permissions.has(PERMISSIONS.REPORTS_VIEW) && actor.permissions.has(def.permission) && (def.also ?? []).every((p) => actor.permissions.has(p));
  }

  private personal(actor: Actor) {
    return actor.role === 'DOCTOR' && !!actor.doctorId;
  }

  catalog(actor: Actor): ReportCatalogEntryDto[] {
    return REPORTS.filter((d) => this.allowed(actor, d)).map((d) => ({
      key: d.key,
      group: d.group,
      title: d.title,
      description: d.description,
      canExport: actor.permissions.has(PERMISSIONS.REPORTS_EXPORT),
      personal: this.personal(actor) && d.doctorScoped,
    }));
  }

  /** Resolves tenant scope, time zone and the doctor filter for the actor. */
  private async context(actor: Actor, q: { from: string; to: string; doctorId?: string; chamberId?: string }, doctorScoped: boolean) {
    let chamberId = actor.chamberId;
    if (!chamberId) {
      if (!isSuperAdmin(actor)) throw AppError.forbidden('Reports require a chamber membership');
      chamberId = q.chamberId ?? null;
    }
    const chamber = chamberId ? await this.prisma.chamber.findUnique({ where: { id: chamberId }, select: { id: true, name: true, timezone: true } }) : null;
    if (chamberId && !chamber) throw AppError.notFound('Chamber');
    let doctorId: string | null = null;
    if (doctorScoped) {
      if (this.personal(actor)) doctorId = actor.doctorId;
      else if (q.doctorId) {
        const d = await this.prisma.doctor.findFirst({ where: { id: q.doctorId, ...(chamberId ? { chamberId } : {}) }, select: { id: true } });
        if (!d) throw AppError.notFound('Doctor');
        doctorId = d.id;
      }
    }
    const tz = chamber?.timezone ?? DEFAULT_TZ;
    const ctx: ReportContext = {
      chamberId,
      doctorId,
      from: q.from,
      to: q.to,
      start: zonedDayRange(q.from, tz).start,
      end: zonedDayRange(q.to, tz).end,
      tz,
      today: zonedDate(new Date(), tz),
    };
    const scope: ReportResultDto['params']['scope'] = doctorId && this.personal(actor) ? 'doctor' : chamberId ? 'chamber' : 'platform';
    return { ctx, chamberName: chamber?.name ?? null, scope };
  }

  async run(actor: Actor, key: string, q: ReportQuery): Promise<ReportResultDto> {
    const def = REPORTS_BY_KEY.get(key as ReportKey);
    if (!def) throw AppError.notFound('Report');
    if (!this.allowed(actor, def)) throw AppError.forbidden();
    const { ctx, chamberName, scope } = await this.context(actor, q, def.doctorScoped);
    const out = await def.run(this.prisma as never, ctx);
    const truncated = out.rows.length > ROW_LIMIT;
    return {
      key: def.key,
      group: def.group,
      title: def.title,
      params: { from: q.from, to: q.to, doctorId: ctx.doctorId, scope, chamberName },
      columns: def.columns,
      rows: truncated ? out.rows.slice(0, ROW_LIMIT) : out.rows,
      summary: out.summary ?? [],
      chart: def.chart ?? null,
      ignoresRange: !!def.ignoresRange,
      truncated,
      generatedAt: new Date().toISOString(),
    };
  }

  /** CSV (UTF-8 with BOM so Excel shows Bangla correctly) or XLSX. Always audited. */
  async export(actor: Actor, key: string, q: ReportQuery, format: ExportFormat, lang: 'en' | 'bn'): Promise<{ filename: string; contentType: string; body: Buffer }> {
    if (!actor.permissions.has(PERMISSIONS.REPORTS_EXPORT)) throw AppError.forbidden('You do not have permission to export reports');
    const report = await this.run(actor, key, q);
    const title = report.title[lang];
    const label = (k: string) => report.columns.find((c) => c.key === k);
    const display = (colKey: string, v: string | number | null) => {
      const c = label(colKey);
      if (v === null || v === undefined) return '';
      if (c?.options && typeof v === 'string') return c.options[v]?.[lang] ?? v;
      if (c?.type === 'datetime' && typeof v === 'string') return v.replace('T', ' ').slice(0, 16);
      return v;
    };
    const base = `${report.key}_${q.from}_${q.to}`;
    await this.audit.record(actor, {
      action: 'report.exported',
      resourceType: 'report',
      resourceId: report.key,
      newValue: { format, from: q.from, to: q.to, doctorId: report.params.doctorId, rows: report.rows.length, scope: report.params.scope },
    });

    if (format === 'csv') {
      const esc = (v: unknown) => {
        const s = String(v ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [report.columns.map((c) => esc(c.label[lang])).join(',')];
      for (const r of report.rows) lines.push(report.columns.map((c) => esc(display(c.key, r[c.key] ?? null))).join(','));
      return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8') };
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Chamber Assistant';
    wb.created = new Date();
    const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([`${report.params.chamberName ?? (lang === 'bn' ? 'সব চেম্বার' : 'All chambers')} · ${report.ignoresRange ? (lang === 'bn' ? 'বর্তমান অবস্থা' : 'Current state') : `${q.from} – ${q.to}`}`]);
    ws.addRow([`${lang === 'bn' ? 'তৈরি' : 'Generated'}: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · ${actor.fullName}`]);
    if (report.summary.length) {
      ws.addRow([]);
      for (const s of report.summary) ws.addRow([s.label[lang], s.value ?? '']);
    }
    ws.addRow([]);
    const header = ws.addRow(report.columns.map((c) => c.label[lang]));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F1' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    });
    for (const r of report.rows) ws.addRow(report.columns.map((c) => display(c.key, r[c.key] ?? null)));
    report.columns.forEach((c, i) => {
      const column = ws.getColumn(i + 1);
      column.width = Math.min(40, Math.max(10, c.label[lang].length + 2, ...report.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2)));
      if (c.type === 'money') column.numFmt = '#,##0.00';
      if (c.type === 'percent') column.numFmt = '0.0"%"';
      if (c.type === 'minutes') column.numFmt = '0.0';
    });
    ws.views = [{ state: 'frozen', ySplit: header.number }];
    const body = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body };
  }

  /** Dashboard charts (spec §33), each included only when the actor may see that kind of report. */
  async dashboard(actor: Actor, days: number): Promise<DashboardAnalyticsDto> {
    if (!actor.permissions.has(PERMISSIONS.REPORTS_VIEW)) throw new AppError(ERROR_CODES.FORBIDDEN, 'Reports are not available for your role', HttpStatus.FORBIDDEN);
    const tz0 = actor.chamberId ? ((await this.prisma.chamber.findUnique({ where: { id: actor.chamberId }, select: { timezone: true } }))?.timezone ?? DEFAULT_TZ) : DEFAULT_TZ;
    const to = zonedDate(new Date(), tz0);
    const from = addDays(to, -(days - 1));
    const { ctx, scope } = await this.context(actor, { from, to }, true);
    const can = (p: string) => actor.permissions.has(p as never);
    const run = async (key: ReportKey) => (await REPORTS_BY_KEY.get(key)!.run(this.prisma as never, ctx)).rows;
    const chamber = ctx.chamberId ? Prisma.sql`AND a.chamber_id = ${ctx.chamberId}::uuid` : Prisma.empty;
    const doctor = ctx.doctorId ? Prisma.sql`AND a.doctor_id = ${ctx.doctorId}::uuid` : Prisma.empty;

    const [appts, patients, revenue, diagnoses, status, workload] = await Promise.all([
      can(PERMISSIONS.REPORTS_VIEW) ? run('appointments-daily') : null,
      can(PERMISSIONS.REPORTS_CLINICAL) ? run('patients-seen') : null,
      can(PERMISSIONS.REPORTS_FINANCIAL) ? run('revenue-daily') : null,
      can(PERMISSIONS.REPORTS_CLINICAL) ? run('diagnosis-stats') : null,
      this.prisma.$queryRaw<{ status: string; count: number }[]>`
        SELECT a.status::text AS status, count(*)::int AS count FROM appointments a
        WHERE a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} ${chamber} ${doctor} GROUP BY a.status ORDER BY 2 DESC`,
      ctx.doctorId
        ? Promise.resolve(null)
        : this.prisma.$queryRaw<{ doctor_name: string; completed: number }[]>`
            SELECT u.full_name AS doctor_name, count(*)::int AS completed FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
            WHERE a.status = 'COMPLETED' AND a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} ${chamber} GROUP BY u.full_name ORDER BY 2 DESC LIMIT 10`,
    ]);
    return {
      from,
      to,
      scope,
      appointmentsPerDay: appts ? appts.map((r) => ({ date: String(r.date), total: Number(r.total), completed: Number(r.completed) })) : null,
      patientsPerDay: patients ? patients.map((r) => ({ date: String(r.date), new: Number(r.new), returning: Number(r.returning) })) : null,
      revenuePerDay: revenue ? revenue.map((r) => ({ date: String(r.date), collected: Number(r.collected), billed: Number(r.billed) })) : null,
      topDiagnoses: diagnoses ? diagnoses.slice(0, 8).map((r) => ({ name: String(r.diagnosis), count: Number(r.count) })) : null,
      appointmentStatus: status,
      doctorWorkload: workload ? workload.map((w) => ({ doctorName: w.doctor_name, completed: w.completed })) : null,
    };
  }
}
