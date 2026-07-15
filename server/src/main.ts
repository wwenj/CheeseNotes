import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { runtimeConfig } from './config/runtime.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: true }), { rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = runtimeConfig();
  if (config.corsOrigins.length) app.enableCors({ origin: config.corsOrigins, credentials: false });
  const publicDir = resolve(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    const fastify = app.getHttpAdapter().getInstance();
    const indexHtml = await fs.readFile(resolve(publicDir, 'index.html'));
    await fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
      index: false,
      maxAge: '1y',
      immutable: true,
    });
    fastify.get('/*', (request: FastifyRequest, reply: FastifyReply) => {
      if (request.url === '/api' || request.url.startsWith('/api/')) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Cannot ${request.method} ${request.url}`,
        });
      }
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
    });
  }
  await app.listen(config.port, config.host);
}
void bootstrap();
