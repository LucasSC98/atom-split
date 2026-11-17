import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import {
  createCheckoutSchema,
  orderParamsSchema,
} from '../schemas/order.schema';
import { OrderService } from '../services/order.service';

export class OrderController {
  constructor(private readonly orderService = new OrderService()) {}

  checkout = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawIdempotencyKey = req.header('Idempotency-Key');

      if (!rawIdempotencyKey || rawIdempotencyKey.trim().length === 0) {
        throw new AppError(
          'O header Idempotency-Key é obrigatório para operações de pagamento.',
          400,
          'MISSING_IDEMPOTENCY_KEY'
        );
      }

      const idempotencyKey = rawIdempotencyKey.trim();
      const validatedBody = createCheckoutSchema.parse(req.body);

      const { order, idempotentReplayed } =
        await this.orderService.processCheckout(idempotencyKey, validatedBody);

      res.setHeader('X-Idempotent-Replayed', String(idempotentReplayed));
      res.status(idempotentReplayed ? 200 : 201).json({
        idempotentReplayed,
        order,
      });
    } catch (error) {
      next(error);
    }
  };

  refund = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = orderParamsSchema.parse(req.params);
      const { order, idempotentReplayed } =
        await this.orderService.refundOrder(orderId);

      res.setHeader('X-Idempotent-Replayed', String(idempotentReplayed));
      res.status(200).json({
        idempotentReplayed,
        order,
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = orderParamsSchema.parse(req.params);
      const order = await this.orderService.getOrderById(orderId);

      res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  };

  list = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const orders = await this.orderService.listOrders();
      res.status(200).json(orders);
    } catch (error) {
      next(error);
    }
  };
}
