import 'reflect-metadata';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisIoAdapter } from './chat/redis-io.adapter';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  // Before the app is created so instrumentation wraps the HTTP layer.
  initSentry();

  // rawBody is required to authenticate payment-gateway callbacks: the
  // signature covers the exact bytes sent, which JSON re-serialisation loses.
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Dev-only: serves what LocalDiskStorageProvider writes to ./uploads. In
  // production STORAGE_PROVIDER=s3 and images are served straight from the
  // bucket/CDN, so this route never exists there.
  if (config.get<string>('STORAGE_PROVIDER') === 'local') {
    app.use(
      '/uploads',
      // helmet's default same-origin CORP would block the web app (a
      // different origin) from embedding these in <img> tags — this route is
      // public images, not sensitive data, so it opts out.
      (_req: express.Request, res: express.Response, next: express.NextFunction) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      },
      express.static(join(process.cwd(), 'uploads')),
    );
  }

  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: true });

  // Chat sockets share the HTTP server; the adapter adds CORS + Redis fan-out.
  const ioAdapter = new RedisIoAdapter(app, config);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
