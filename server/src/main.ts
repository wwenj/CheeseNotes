import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { runtimeConfig } from './config/runtime.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: true }), { rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const publicDir = resolve(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    await app.getHttpAdapter().getInstance().register(fastifyStatic, { root: publicDir, prefix: '/' });
  }
  const config = runtimeConfig();
  await app.listen(config.port, config.host);
}
void bootstrap();
