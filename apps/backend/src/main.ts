import './tracing';
import './instrument';
import * as compression from 'compression';
import * as express from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { RequestValidationMiddleware } from './common/middleware/request-validation.middleware';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { MetricsService } from './metrics/metrics.service';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IdempotencyService } from './common/idempotency/idempotency.service';
import { AppDataSource } from './data-source';
import {
  API_VERSION_HEADER,
  API_VERSIONS,
  DEFAULT_API_VERSION,
  LATEST_API_VERSION,
  getVersionInfo,
} from './common/versioning';

// #1008: Global request body size limit (1MB).
const BODY_SIZE_LIMIT = '1mb';

// #1026: Bounded graceful shutdown timeout. If in-flight requests or resource
// teardown do not finish within this window, the process exits anyway so it can
// never hang indefinitely.
const SHUTDOWN_TIMEOUT_MS = 30_000;

// #1010: ETag support for client-side caching of GET responses.
function computeETag(body: Buffer | string): string {
  const hash = createHash('sha1').update(body).digest('base64');
  return `"${hash}"`;
}

// #1010: Attach an ETag to GET responses and honor conditional requests via
// If-None-Match, returning 304 Not Modified when the ETag matches. Non-GET
// requests are left untouched.
function etagMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const originalSend = res.send.bind(res);
  res.send = (body?: any): express.Response => {
    if (body !== undefined && body !== null && !res.getHeader('ETag')) {
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const etag = computeETag(payload);
      res.setHeader('ETag', etag);

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch.split(',').map((t) => t.trim()).includes(etag)) {
        res.status(304);
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Length');
        return originalSend();
      }
    }
    return originalSend(body);
  };

  next();
}

// #1026: Register SIGTERM/SIGINT handlers that stop accepting new connections,
// let in-flight requests drain, then close downstream resources (DB) before
// exiting. A bounded timeout guarantees the process cannot hang forever.
function registerGracefulShutdown(app: { close: () => Promise<void> }, logger: Logger) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log(`Received ${signal}, starting graceful shutdown...`);

    const forceExit = setTimeout(() => {
      logger.error(
        `Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Do not keep the event loop alive solely for this timer.
    forceExit.unref();

    try {
      // Stop accepting new connections and wait for in-flight requests.
      await app.close();
      logger.log('HTTP server closed, no longer accepting connections.');

      // Close downstream resources (DB/Redis) before exiting.
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
        logger.log('Database connection closed.');
      }

      clearTimeout(forceExit);
      logger.log('Graceful shutdown complete.');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExit);
      logger.error(`Error during graceful shutdown: ${error}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function runMigrationCommand(command: string) {
  const logger = new Logger('MigrationCommand');

  try {
    await AppDataSource.initialize();
    logger.log('DataSource initialized');

    switch (command) {
      case 'migration:run': {
        const migrations = await AppDataSource.runMigrations();
        if (migrations.length === 0) {
          logger.log('No pending migrations.');
        } else {
          logger.log(`Executed ${migrations.length} migration(s):`);
          migrations.forEach((m) => logger.log(`  ${m.name}`));
        }
        break;
      }
      case 'migration:revert': {
        await AppDataSource.undoLastMigration();
        logger.log('Last migration reverted.');
        break;
      }
      default:
        logger.error(`Unknown migration command: ${command}`);
        process.exit(1);
    }

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    logger.error(`Migration command "${command}" failed: ${error}`);
    process.exit(1);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  if (migrationCommand) {
    await runMigrationCommand(migrationCommand);
    return;
  }

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });
  logger.log(`Nest application initialized in ${Date.now() - startupStartedAt}ms`);
  app.enableShutdownHooks();

  // #1026: Handle SIGTERM/SIGINT for graceful shutdown.
  registerGracefulShutdown(app, logger);

  // #1008: Reject request bodies larger than the global limit with 413.
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

  // #1010: ETag support for GET responses (conditional requests → 304).
  app.use(etagMiddleware);

  // #882: Enable gzip compression for responses >1KB
  app.use(
    compression({
      threshold: 1024, // Only compress responses larger than 1KB
      level: 6,        // Balanced compression level (0-9)
      filter: (req, res) => {
        // Respect Cache-Control: no-transform
        if (res.getHeader('Cache-Control')?.toString().includes('no-transform')) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
  const configService = app.get(ConfigService);

  const port = configService.get<number>('port');
  const nodeEnv = configService.get<string>('nodeEnv');

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const correlationId = new CorrelationIdMiddleware();
  const requestValidation = new RequestValidationMiddleware();
  app.use((req, res, next) => correlationId.use(req, res, next));
  app.use((req, res, next) => requestValidation.use(req, res, next));

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'health/ready', 'health/startup', 'health/environment', 'health/version'] });
  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties not declared in the DTO
      whitelist: true,
      // Reject requests that contain extra properties not in the DTO
      forbidNonWhitelisted: true,
      // Auto-transform plain objects to DTO class instances and coerce
      // primitive query/path params to their declared types (e.g. "1" → 1)
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Return all constraint violations at once instead of stopping at first
      stopAtFirstError: false,
    }),
    new SanitizationPipe(),
  );
  app.useGlobalFilters(new HttpExceptionFilter(), new ValidationExceptionFilter());
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new MetricsInterceptor(app.get(MetricsService)),
    new IdempotencyInterceptor(app.get(IdempotencyService)),
  );

  const corsOrigins = configService.get<string[]>('cors.origins') || ['http://localhost:3001'];
  const corsCredentials = configService.get<boolean>('cors.credentials') ?? false;
  const corsPreflight = configService.get<number>('cors.maxAge') ?? 86400;

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY', 'X-Webhook-Signature', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'ETag'],
    credentials: corsCredentials,
    maxAge: corsPreflight,
  });

  app.enableCors();

  // #1162: Swagger UI must not be publicly reachable in production. It is
  // enabled by default outside production (local/staging) and can be opted into
  // in production via SWAGGER_ENABLED=true, in which case /api/docs is gated
  // behind HTTP Basic Auth using SWAGGER_PASSWORD.
  const isProduction = nodeEnv === 'production';
  const swaggerEnabledConfig = configService.get<boolean | string>('swagger.enabled');
  const swaggerEnabled =
    swaggerEnabledConfig === true || swaggerEnabledConfig === 'true';
  const shouldExposeSwagger = !isProduction || swaggerEnabled;

  if (shouldExposeSwagger) {
    if (isProduction) {
      const swaggerPassword = configService.get<string>('swagger.password');
      const swaggerUser = configService.get<string>('swagger.user') || 'admin';

      app.use('/api/docs', (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!swaggerPassword) {
          res.status(401).set('WWW-Authenticate', 'Basic realm="Swagger"').end();
          return;
        }

        const header = req.headers.authorization || '';
        const [scheme, encoded] = header.split(' ');
        if (scheme !== 'Basic' || !encoded) {
          res.status(401).set('WWW-Authenticate', 'Basic realm="Swagger"').end();
          return;
        }

        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const separatorIndex = decoded.indexOf(':');
        const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
        const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

        if (user !== swaggerUser || password !== swaggerPassword) {
          res.status(401).set('WWW-Authenticate', 'Basic realm="Swagger"').end();
          return;
        }

        next();
      });
    }
    const config = new DocumentBuilder()
    .setTitle('scoopdope API')
    .setDescription(
      'Blockchain education platform API powered by Stellar\n\n' +
        '## API Versioning\n\n' +
        'This API uses **URL-based versioning**. All requests must include the version prefix.\n\n' +
        `Current version: **${LATEST_API_VERSION}** | Supported: ${API_VERSIONS.join(', ')}\n\n` +
        '### Version Headers\n\n' 

/* … truncated 1461 chars — edit only what you need near the top … */
