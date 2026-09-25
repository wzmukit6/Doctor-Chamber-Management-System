import './load-env';
import 'reflect-metadata';
import { ConsoleLogger, Logger, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { loadConfig } from './config/config';

async function bootstrap() {
  const config = loadConfig();
  const levels: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const logger = new ConsoleLogger({
    json: config.LOG_FORMAT === 'json',
    colors: config.LOG_FORMAT !== 'json',
    logLevels: levels.slice(0, levels.indexOf(config.LOG_LEVEL) + 1),
  });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger });
  configureApp(app);
  if (!config.isProduction) setupSwagger(app);
  await app.listen(config.PORT);
  Logger.log(`Chamber Assistant API listening on :${config.PORT} (${config.NODE_ENV})`, 'Bootstrap');
}

void bootstrap();
