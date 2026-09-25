import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadConfig } from './config/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ChambersModule } from './modules/chambers/chambers.module';
import { HealthModule } from './modules/health/health.module';
import { PatientsModule } from './modules/patients/patients.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { JsonContentMiddleware } from './common/guards/json-content.middleware';

const config = loadConfig();

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }]),
    PrismaModule,
    AuthorizationModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    RolesModule,
    OrganizationsModule,
    ChambersModule,
    PatientsModule,
    SettingsModule,
    DoctorsModule,
    AppointmentsModule,
    CatalogModule,
    ConsultationsModule,
    PrescriptionsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // Guard order matters: rate limit → authenticate (+CSRF) → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(JsonContentMiddleware).forRoutes('*');
  }
}
