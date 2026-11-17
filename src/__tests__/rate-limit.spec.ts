import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../middlewares/rateLimiter';

describe('Rate Limiter Middleware (HTTP 429)', () => {
  it('deve retornar HTTP 429 no formato padrão (RATE_LIMITED) ao exceder o limite configurado, mantendo /health isento', async () => {
    const testApp = express();
    testApp.set('trust proxy', 1);

    const lowLimiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      forceEnable: true,
    });

    testApp.use(lowLimiter);

    testApp.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    testApp.post('/orders/checkout', (_req, res) => {
      res.status(201).json({ status: 'created' });
    });

    // 1ª e 2ª requisições passam normalmente
    const res1 = await request(testApp).post('/orders/checkout');
    const res2 = await request(testApp).post('/orders/checkout');
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // 3ª requisição estoura o limite de 2 req/min -> HTTP 429 RATE_LIMITED
    const res3 = await request(testApp).post('/orders/checkout');
    expect(res3.status).toBe(429);
    expect(res3.body).toEqual({
      status: 'error',
      code: 'RATE_LIMITED',
      message: expect.any(String),
    });

    // /health deve continuar respondendo 200 mesmo após o IP estar limitado
    const healthRes = await request(testApp).get('/health');
    expect(healthRes.status).toBe(200);
  });
});
