import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { loadConfig } from './config/config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  if (!config.isProduction) setupSwagger(app);
  await app.listen(config.PORT);
  Logger.log(`Chamber Assistant API listening on :${config.PORT} (${config.NODE_ENV})`, 'Bootstrap');
}

void bootstrap();
