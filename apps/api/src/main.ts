import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const express = app.getHttpAdapter().getInstance()
  express.set('etag', false)
  express.use(
    (
      _request: unknown,
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      response.setHeader('Cache-Control', 'no-store')
      next()
    },
  )
  const configuredOrigins = (
    process.env.WEB_ORIGINS ??
    process.env.WEB_ORIGIN ??
    'http://localhost:5173'
  )
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  // The API is intentionally reachable from a LAN during local development.
  // Production keeps an explicit origin allowlist.
  app.enableCors({ origin: process.env.NODE_ENV === 'production' ? configuredOrigins : true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(Number(process.env.API_PORT ?? 3001))
}
void bootstrap()
