import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { routes } from './routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['X-Idempotent-Replayed'],
  })
);
app.use(express.json());

// Registra rotas em /api (ex: POST /api/users, GET /api/orders, GET /api/wallets/:walletId/statement)
// e mantém compatibilidade em /api/v1
app.use('/api', routes);
app.use('/api/v1', routes);

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'marketplace-payment-split-api',
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);

export { app };
