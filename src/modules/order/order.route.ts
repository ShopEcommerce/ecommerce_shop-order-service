import express, { RequestHandler } from 'express';
import { OrderController } from './order.controller';
import { requireAuth, requireRole, asyncHandler } from '@teleshop/common';
import { validateZod } from '../../middlewares/validate.middleware';
import {
  createOrderSchema,
  cancelOrderSchema,
  customerOrderQuerySchema,
  returnRequestSchema,
  sellerOrderQuerySchema,
  sellerOrderStatusSchema,
  sellerReturnQuerySchema,
  sellerReturnStatusSchema,
} from './order.schema';

const router = express.Router();
const requireAuthMw = requireAuth as unknown as RequestHandler;
const requireSellerMw = requireRole(['SELLER', 'ADMIN']) as unknown as RequestHandler;

router.use(requireAuthMw);

router.get(
  '/seller/me',
  requireSellerMw,
  validateZod(sellerOrderQuerySchema),
  asyncHandler(OrderController.getSellerOrders as any),
);

router.patch(
  '/:id/status',
  requireSellerMw,
  validateZod(sellerOrderStatusSchema),
  asyncHandler(OrderController.updateOrderStatusBySeller as any),
);

router.get(
  '/seller/cancellations',
  requireSellerMw,
  validateZod(sellerOrderQuerySchema),
  asyncHandler(OrderController.getSellerCancellations as any),
);

router.get(
  '/seller/cancellations/:id',
  requireSellerMw,
  asyncHandler(OrderController.getSellerCancellationById as any),
);

router.get(
  '/seller/returns',
  requireSellerMw,
  validateZod(sellerReturnQuerySchema),
  asyncHandler(OrderController.getSellerReturns as any),
);

router.get(
  '/seller/returns/:id',
  requireSellerMw,
  asyncHandler(OrderController.getSellerReturnById as any),
);

router.patch(
  '/seller/returns/:id/status',
  requireSellerMw,
  validateZod(sellerReturnStatusSchema),
  asyncHandler(OrderController.updateSellerReturnStatus as any),
);

router.post('/', validateZod(createOrderSchema), asyncHandler(OrderController.createOrder as any));

router.get(
  '/',
  validateZod(customerOrderQuerySchema),
  asyncHandler(OrderController.getCustomerOrders as any),
);

router.get('/:id', asyncHandler(OrderController.getOrder as any));

router.post(
  '/:id/cancel',
  validateZod(cancelOrderSchema),
  asyncHandler(OrderController.cancelOrder as any),
);

router.post(
  '/:id/return',
  validateZod(returnRequestSchema),
  asyncHandler(OrderController.requestReturn as any),
);

export { router as orderRouter };
