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
      error: 'Missing shipping information' 
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
  body: z.object({
    reason: z.string().min(10, 'Vui lòng mô tả chi tiết lý do trả hàng (ít nhất 10 ký tự)'),
  }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>['body'];
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>['body'];
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>['body'];