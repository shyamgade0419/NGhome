import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

// Feature modules
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SocietiesModule } from './societies/societies.module';
import { BuildingsModule } from './buildings/buildings.module';
import { FlatsModule } from './flats/flats.module';
import { BillingRulesModule } from './billing-rules/billing-rules.module';
import { BillingModule } from './billing/billing.module';
import { WaterModule } from './water/water.module';
import { PaymentsModule } from './payments/payments.module';
import { AccountsModule } from './accounts/accounts.module';
import { FundsModule } from './funds/funds.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ExpensesModule } from './expenses/expenses.module';
import { SalariesModule } from './salaries/salaries.module';
import { StatementsModule } from './statements/statements.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { MeetingsModule } from './meetings/meetings.module';
import { DocumentsModule } from './documents/documents.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,

    // Features
    AuthModule,
    UsersModule,
    SocietiesModule,
    BuildingsModule,
    FlatsModule,
    BillingRulesModule,
    BillingModule,
    WaterModule,
    PaymentsModule,
    AccountsModule,
    FundsModule,
    TransactionsModule,
    ExpensesModule,
    SalariesModule,
    StatementsModule,
    AnnouncementsModule,
    MeetingsModule,
    DocumentsModule,
    AuditLogsModule,
    NotificationsModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    // Global guards
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global filters and interceptors
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
