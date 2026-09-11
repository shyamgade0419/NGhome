import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Decimal } from '@prisma/client/runtime/library';
import { AppModule } from './app.module';
import { validateProductionConfig } from './config/validate-production-config';

// Prisma uses decimal.js-light which lacks toJSON(). Without this patch, Decimal fields
// serialize as raw {s, e, d} objects instead of numeric strings, causing NaN on the frontend.
(Decimal.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 3000;
  const nodeEnv = configService.get<string>('nodeEnv') ?? 'development';

  // Fail fast in production rather than come up misconfigured — bad secrets
  // or a non-SFTP storage provider would otherwise only surface the first
  // time someone logs in or uploads a file. See validate-production-config.ts.
  validateProductionConfig(configService);

  // Security
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS
  const corsOrigins = configService.get<string[]>('cors.origins') ?? ['http://localhost:3000'];
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'docs'] });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ClassSerializerInterceptor deliberately NOT registered. It runs every
  // response through class-transformer's instanceToPlain(), which does a
  // property-by-property flatten of the object graph and does not call
  // toJSON() on nested values — so every Prisma Decimal field came out as
  // the raw {s, e, d} internal shape instead of a numeric string, silently,
  // on every endpoint. Proven directly: instanceToPlain({amount: new
  // Decimal('4250')}) serializes to {"amount":{"s":1,"e":3,"d":[4250]}},
  // while plain JSON.stringify on the same value correctly produces
  // {"amount":"4250"} via the toJSON patch below. flats.service.ts already
  // worked around this once, per-field, for Flat.area — the same defect was
  // silently present on every other Decimal column (bill totals, account
  // balances, everything) since nothing in this codebase actually uses
  // @Exclude/@Expose, which is the only thing this interceptor would have
  // been doing for us. Removing it lets the toJSON patch work as intended.

  // Swagger (only in non-production or when explicitly enabled)
  const swaggerEnabled = configService.get<boolean>('swagger.enabled') ?? nodeEnv !== 'production';
  if (swaggerEnabled) {
    const swaggerPath = configService.get<string>('swagger.path') ?? 'docs';
    const config = new DocumentBuilder()
      .setTitle('NG Home API')
      .setDescription(
        'Multi-tenant Apartment Community Management SaaS — Powered by NovaGade\n\n' +
        'All endpoints (except /auth/login, /auth/refresh, /health) require a Bearer JWT token.\n' +
        'Society-scoped endpoints derive the tenant from the authenticated token — ' +
        'never trust societyId from the request body for normal users.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Authentication')
      .addTag('Users')
      .addTag('Societies')
      .addTag('Buildings')
      .addTag('Flats')
      .addTag('Billing Rules')
      .addTag('Billing')
      .addTag('Water Billing')
      .addTag('Payments')
      .addTag('Accounts')
      .addTag('Funds')
      .addTag('Transactions')
      .addTag('Expenses')
      .addTag('Salaries')
      .addTag('Monthly Statements')
      .addTag('Announcements')
      .addTag('Meetings')
      .addTag('Events')
      .addTag('Documents')
      .addTag('Audit Logs')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
      },
    });
  }

  // Listen on 0.0.0.0 so Docker/Coolify can route traffic
  await app.listen(port, '0.0.0.0');

  console.log(`\n🏢 NG Home API running on http://0.0.0.0:${port}`);
  console.log(`📍 Environment: ${nodeEnv}`);
  if (swaggerEnabled) {
    console.log(`📖 Swagger docs: http://0.0.0.0:${port}/docs\n`);
  }
}

bootstrap().catch((error: unknown) => {
  // Write a clear, structured error to stderr so it is visible in Coolify Runtime Logs
  // even if the process exits before stdout flushes.
  const msg   = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  process.stderr.write(
    `\n${'='.repeat(60)}\n` +
    `BOOTSTRAP FAILED\n` +
    `Error: ${msg}\n` +
    (stack ? `${stack}\n` : '') +
    `${'='.repeat(60)}\n`,
  );
  process.exit(1);
});
