import { Request, Response } from 'express';
import { OrderService } from './order.service';
import pino from 'pino';
import { CancelOrderInput, SellerOrderStatusInput, SellerReturnStatusInput } from './order.schema';
import { OrderStatus, ReturnStatus } from '@prisma/client';

// Cấu hình Logger
const logger = pino({
  name: 'OrderController',
  level: process.env.LOG_LEVEL || 'info',
});

export class OrderController {
  static async createOrder(req: Request, res: Response) {
    const userId = req.currentUser!.id;
    const correlationId = req.correlationId || req.header('x-correlation-id') || 'N/A';

    const token =
      req.headers.authorization ||
      (req as Request & { session?: { jwt?: string } }).session?.jwt ||
      undefined;

    logger.info(
      { correlationId, userId, action: 'createOrder' },
      'Beginning to process order creation request',
    );

    const order = await OrderService.createOrder(userId, req.body, token, correlationId);

    logger.info(
      { correlationId, orderId: order.id },
      'Order created successfully, preparing to activate Saga',
    );
    res.status(201).send({ message: 'Order created successfully', data: order });
  }

  static async cancelOrder(req: Request<{ id: string }, unknown, CancelOrderInput>, res: Response) {
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

  static async requestReturn(
    req: Request<{ id: string }, unknown, { reason: string }>,
    res: Response,
  ) {
    const userId = req.currentUser!.id;
    const { id } = req.params;
    const { reason } = req.body;

    logger.info({ orderId: id, userId }, 'Request to return/refund order');

    const returnReq = await OrderService.requestReturn(id, userId, reason);

    logger.info({ orderId: id, returnId: returnReq.id }, 'Return request created successfully');
    res.status(201).send({
      message: 'Return request submitted successfully, please wait for approval',
      data: returnReq,
    });
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

  static async getSellerOrders(req: Request, res: Response) {
    const sellerId = req.currentUser!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as OrderStatus | undefined;
    const search = req.query.search as string | undefined;

    const result = await OrderService.getSellerOrders(sellerId, page, limit, status, search);
    res.status(200).send({ data: result.data, meta: { page, limit, total: result.total } });
  }

  static async updateOrderStatusBySeller(
    req: Request<{ id: string }, unknown, SellerOrderStatusInput>,
    res: Response,
  ) {
    const sellerId = req.currentUser!.id;
    const role = req.currentUser!.role;
    const correlationId = req.correlationId || 'N/A';

    const order = await OrderService.updateOrderStatusBySeller(
      req.params.id,
      sellerId,
      role,
      req.body.status as OrderStatus,
      req.body.note,
      correlationId,
    );

    res.status(200).send({ message: 'Order status updated successfully', data: order });
  }

  static async getSellerCancellations(req: Request, res: Response) {
    const sellerId = req.currentUser!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string | undefined;

    const result = await OrderService.getSellerCancellations(sellerId, page, limit, search);
    res.status(200).send({ data: result.data, meta: { page, limit, total: result.total } });
  }

  static async getSellerCancellationById(req: Request<{ id: string }>, res: Response) {
    const sellerId = req.currentUser!.id;
    const role = req.currentUser!.role;
    const order = await OrderService.getOrderById(req.params.id, sellerId, role);
    if (order.status !== OrderStatus.CANCELLED) {
      res.status(404).send({ errors: [{ message: 'Cancellation not found' }] });
      return;
    }
    res.status(200).send({ data: order });
  }

  static async getSellerReturns(req: Request, res: Response) {
    const sellerId = req.currentUser!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as ReturnStatus | undefined;
    const search = req.query.search as string | undefined;

    const result = await OrderService.getSellerReturns(sellerId, page, limit, status, search);
    res.status(200).send({ data: result.data, meta: { page, limit, total: result.total } });
  }

  static async getSellerReturnById(req: Request<{ id: string }>, res: Response) {
    const sellerId = req.currentUser!.id;
    const request = await OrderService.getSellerReturnById(req.params.id, sellerId);
    res.status(200).send({ data: request });
  }

  static async updateSellerReturnStatus(
    req: Request<{ id: string }, unknown, SellerReturnStatusInput>,
    res: Response,
  ) {
    const sellerId = req.currentUser!.id;
    const updated = await OrderService.updateSellerReturnStatus(
      req.params.id,
      sellerId,
      req.body.status as ReturnStatus,
      req.body.adminNote,
    );

    res.status(200).send({ message: 'Return request updated successfully', data: updated });
  }
}
