import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';

const orderRoutes = Router();
const orderController = new OrderController();

orderRoutes.get('/', orderController.list);
orderRoutes.post('/checkout', orderController.checkout);
orderRoutes.post('/:orderId/refund', orderController.refund);
orderRoutes.get('/:orderId', orderController.getById);

export { orderRoutes };
