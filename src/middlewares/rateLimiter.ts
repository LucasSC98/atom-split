import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';

export interface CreateRateLimiterOptions {
  windowMs?: number;
  max: number;
  message?: string;
  /**
   * Permite forçar a ativação do rate limiter mesmo em NODE_ENV=test
   * para testes dedicados do comportamento HTTP 429.
   */
  forceEnable?: boolean;
}

export function createRateLimiter(
  options: CreateRateLimiterOptions
): RateLimitRequestHandler {
  const {
    windowMs = 60 * 1000,
    max,
    message = 'Muitas requisições deste endereço IP. Por favor, aguarde um instante antes de tentar novamente.',
    forceEnable = false,
  } = options;

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => {
      if (!forceEnable && env.NODE_ENV === 'test') {
        return true;
      }
      if (req.path === '/health' || req.path.endsWith('/health')) {
        return true;
      }
      return false;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        status: 'error',
        code: 'RATE_LIMITED',
        message,
      });
    },
  });
}

// Limite geral da API: 120 requisições por minuto por IP
export const generalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message:
    'Limite de requisições excedido (máx. 120 req/min). Aguarde um instante e tente novamente.',
});

// Limite estrito para operações financeiras de escrita (checkout e refund): 30 req/min por IP
export const strictFinancialRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message:
    'Limite de operações financeiras excedido (máx. 30 req/min). Aguarde um instante antes de realizar novo pagamento ou estorno.',
});
