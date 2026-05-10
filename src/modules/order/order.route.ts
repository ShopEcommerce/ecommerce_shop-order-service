import express, { RequestHandler } from 'express';
import { OrderController } from './order.controller';
import { requireAuth, asyncHandler } from '@teleshop/common';
import { validateZod } from '../../middlewares/validate.middleware';
import { createOrderSchema, cancelOrderSchema, returnRequestSchema } from './order.schema';

const router = express.Router();
const requireAuthMw = requireAuth as unknown as RequestHandler;

router.use(requireAuthMw);

router.post('/', validateZod(createOrderSchema), asyncHandler(OrderController.createOrder as any));

router.get('/', asyncHandler(OrderController.getCustomerOrders as any));

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
