import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 3000;
  const nodeEnv = configService.get<string>('nodeEnv') ?? 'development';

  // Fail fast in production if critical secrets are missing or still at insecure defaults
  if (nodeEnv === 'production') {
    const accessSecret = configService.get<string>('jwt.accessSecret');
    const refreshSecret = configService.get<string>('jwt.refreshSecret');
    const insecureDefaults = ['default-access-secret', 'default-refresh-secret'];
    if (!accessSecret || insecureDefaults.includes(accessSecret)) {
      throw new Error('FATAL: JWT_ACCESS_SECRET must be set to a secure value in production');
    }
    if (!refreshSecret || insecureDefaults.includes(refreshSecret)) {
      throw new Error('FATAL: JWT_REFRESH_SECRET must be set to a secure value in production');
    }
    if (!process.env.DATABASE_URL) {
      throw new Error('FATAL: DATABASE_URL must be set in production');
    }
  }

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

  // Serialization
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

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

bootstrap().catch(console.error);
