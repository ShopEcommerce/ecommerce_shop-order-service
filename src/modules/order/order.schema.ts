import { z } from 'zod';

const orderItemPayload = z.object({
  productId: z.string().uuid('Invalid product ID'),
  sellerId: z.string().uuid('Invalid seller ID'),
  variantId: z.string().uuid('Invalid variant ID'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  unitPrice: z.number().positive('Unit price must be a positive number'),
});

export const createOrderSchema = z.object({
  body: z.object({
    shippingAddress: z.record(z.string(), z.unknown(), {
      error: 'Missing shipping information',
    }),
    items: z.array(orderItemPayload).min(1, 'Order must have at least 1 product'),
    couponCode: z.string().optional(),
  }),
});

export const cancelOrderSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid order ID'),
  }),
  body: z.object({
    cancelReason: z.string().min(5, 'Cancel reason must have at least 5 characters'),
  }),
});

export const returnRequestSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid order ID'),
  }),
  body: z.object({
    reason: z.string().min(10, 'Vui lòng mô tả chi tiết lý do trả hàng (ít nhất 10 ký tự)'),
  }),
});

const orderStatusEnum = z.enum([
  'PENDING',
  'AWAITING_PAYMENT',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
]);

const returnStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED']);

export const sellerOrderQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: orderStatusEnum.optional(),
    search: z.string().trim().optional(),
  }),
});

export const sellerReturnQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: returnStatusEnum.optional(),
    search: z.string().trim().optional(),
  }),
});

export const sellerReturnStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid return request ID'),
  }),
  body: z.object({
    status: z.enum(['APPROVED', 'REJECTED', 'REFUNDED']),
    adminNote: z.string().trim().max(500).optional(),
  }),
});

export const sellerOrderStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid order ID'),
  }),
  body: z.object({
    status: z.enum(['PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED']),
    note: z.string().trim().max(500).optional(),
  }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>['body'];
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>['body'];
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>['body'];
export type SellerOrderStatusInput = z.infer<typeof sellerOrderStatusSchema>['body'];
export type SellerReturnStatusInput = z.infer<typeof sellerReturnStatusSchema>['body'];
