import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { routes } from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { generalRateLimiter } from './middlewares/rateLimiter';

// Garante serialização JSON segura para campos BigInt (ex: LedgerEntry.seq)
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

const app = express();

// Necessário para identificar corretamente o IP real do cliente atrás do proxy reverso do Render
app.set('trust proxy', 1);

const allowedOrigins = (env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin:
      env.NODE_ENV === 'production'
        ? (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
              return;
            }
            callback(null, false);
          }
        : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['X-Idempotent-Replayed'],
  })
);
app.use(express.json());

// /health fica fora do rate limit
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'marketplace-payment-split-api',
    timestamp: new Date().toISOString(),
  });
});

// Registra rotas em /api e mantém compatibilidade em /api/v1 com rate limiter geral (120 req/min)
app.use('/api', generalRateLimiter, routes);
app.use('/api/v1', generalRateLimiter, routes);

app.use(errorHandler);

export { app };
