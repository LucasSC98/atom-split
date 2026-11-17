import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { userRoutes } from './user.routes';
import { walletRoutes } from './wallet.routes';
import { orderRoutes } from './order.routes';

const routes = Router();

routes.get('/health', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  res.status(200).json({
    status: 'ok',
    service: 'marketplace-payment-split-api',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

routes.use('/users', userRoutes);
routes.use('/wallets', walletRoutes);
routes.use('/orders', orderRoutes);

export { routes };
