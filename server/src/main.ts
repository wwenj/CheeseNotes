import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, promises as fs } from 'node:fs';
import { extname, resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { runtimeConfig } from './config/runtime.config.js';

const assetContentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.js': 'text/javascript; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }), { rawBody: true });
  await app.register(cookie);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const config = runtimeConfig();
  if (config.corsOrigins.length) {
    app.enableCors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }
  const fastify = app.getHttpAdapter().getInstance();
  fastify.get('/.well-known/apple-app-site-association', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .type('application/json; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send({ applinks: { details: [{ appIDs: [config.iosAppId], components: [{ '/': '/ios/auth/*' }] }] } });
  });
  fastify.get('/ios/auth/callback', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>芝士</title><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#fff;color:#303b49;font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><main style="text-align:center"><strong style="font-size:24px">芝士</strong><p>请返回 App 继续登录。</p></main></body></html>');
  });
  const publicDir = resolve(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    const indexPath = resolve(publicDir, 'index.html');
    fastify.get('/assets/:file', async (request: FastifyRequest<{ Params: { file: string } }>, reply: FastifyReply) => {
      const { file } = request.params;
      if (!/^[\w.-]+$/.test(file)) return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      try {
        const asset = await fs.readFile(resolve(publicDir, 'assets', file));
        return reply
          .type(assetContentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream')
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(asset);
      } catch {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found' });
      }
    });
    fastify.get('/noteai-icon.png', async (_request: FastifyRequest, reply: FastifyReply) => {
      const icon = await fs.readFile(resolve(publicDir, 'noteai-icon.png'));
      return reply.type('image/png').header('Cache-Control', 'public, max-age=31536000, immutable').send(icon);
    });
    fastify.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.url === '/api' || request.url.startsWith('/api/')) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Cannot ${request.method} ${request.url}`,
        });
      }
      const indexHtml = await fs.readFile(indexPath);
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
    });
  }
  await app.listen(config.port, config.host);
}
void bootstrap();
