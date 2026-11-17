import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { strictFinancialRateLimiter } from '../middlewares/rateLimiter';

const orderRoutes = Router();
const orderController = new OrderController();

orderRoutes.get('/', orderController.list);
orderRoutes.post('/checkout', strictFinancialRateLimiter, orderController.checkout);
orderRoutes.post(
  '/:orderId/refund',
  strictFinancialRateLimiter,
  orderController.refund
);
orderRoutes.get('/:orderId', orderController.getById);

export { orderRoutes };
