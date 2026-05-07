import { Request, Response } from 'express';
import { OrderService } from './order.service';
import pino from 'pino';
import { CancelOrderInput } from './order.schema';

// Cấu hình Logger
const logger = pino({
  name: 'OrderController',
  level: process.env.LOG_LEVEL || 'info',
});

export class OrderController {
  
  static async createOrder(req: Request, res: Response) {
    const userId = req.currentUser!.id;
    const correlationId = req.correlationId || req.header('x-correlation-id') || 'N/A';

    logger.info({ correlationId, userId, action: 'createOrder' }, 'Beginning to process order creation request');

    const order = await OrderService.createOrder(userId, req.body, correlationId);
    
    logger.info({ correlationId, orderId: order.id }, 'Order created successfully, preparing to activate Saga');
    res.status(201).send({ message: 'Order created successfully', data: order });
  }

  static async cancelOrder(req: Request<{ id: string }, {}, CancelOrderInput>, res: Response) {
    const userId = req.currentUser!.id;
    const role = req.currentUser!.role;
    const { id } = req.params;
    const { cancelReason } = req.body;
    const correlationId = req.correlationId || 'N/A';

    logger.info({ correlationId, orderId: id, userId }, 'Request to cancel order');

    const order = await OrderService.cancelOrder(id, userId, role, cancelReason, correlationId);
    
    logger.info({ correlationId, orderId: id }, 'Order cancelled successfully');
    res.status(200).send({ message: 'Order cancelled successfully', data: order });
  }

  static async requestReturn(req: Request<{ id: string }, {}, { reason: string }>, res: Response) {
    const userId = req.currentUser!.id;
    const { id } = req.params;
    const { reason } = req.body;

    logger.info({ orderId: id, userId }, 'Request to return/refund order');

    const returnReq = await OrderService.requestReturn(id, userId, reason);
    
    logger.info({ orderId: id, returnId: returnReq.id }, 'Return request created successfully');
    res.status(201).send({ message: 'Return request submitted successfully, please wait for approval', data: returnReq });
  }

  static async getOrder(req: Request<{ id: string }>, res: Response) {
    const userId = req.currentUser!.id;
    const role = req.currentUser!.role;
    const { id } = req.params;

    const order = await OrderService.getOrderById(id, userId, role);
    res.status(200).send({ data: order });
  }

  static async getCustomerOrders(req: Request, res: Response) {
    const userId = req.currentUser!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const orders = await OrderService.getCustomerOrders(userId, page, limit);
    res.status(200).send({ data: orders, meta: { page, limit } });
  }
}