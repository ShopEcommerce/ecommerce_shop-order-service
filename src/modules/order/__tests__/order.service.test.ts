import { OrderStatus } from '@prisma/client';
import axios from 'axios';
import { OrderRepository } from '../order.repository';
import { OrderService } from '../order.service';

jest.mock('axios');
jest.mock('../order.repository');

describe('OrderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('validates prices, reserves coupon, and creates the order', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({
          data: {
            'variant-1': 120000,
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: {
              coupon: {
                discountType: 'PERCENTAGE',
                discountValue: 10,
              },
            },
          },
        });

      (OrderRepository.createOrder as jest.Mock).mockResolvedValue({
        id: 'order-1',
      });

      await OrderService.createOrder(
        'user-1',
        {
          shippingAddress: { city: 'HCM' },
          couponCode: 'SAVE10',
          items: [
            {
              productId: 'product-1',
              sellerId: 'seller-1',
              variantId: 'variant-1',
              quantity: 2,
            },
          ],
        },
        'token-123',
        'corr-1',
      );

      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        'http://localhost:3003/api/product/validate-prices',
        { variantIds: ['variant-1'] },
        {
          headers: { 'x-correlation-id': 'corr-1' },
        },
      );

      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3008/api/promotions/coupons/reserve',
        {
          code: 'SAVE10',
          orderId: expect.any(String),
          orderAmount: 240000,
        },
        {
          headers: {
            Authorization: 'Bearer token-123',
            'x-correlation-id': 'corr-1',
          },
        },
      );

      expect(OrderRepository.createOrder).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              unitPrice: 120000,
            }),
          ],
          couponCode: 'SAVE10',
          discountAmount: 24000,
          totalAmount: 216000,
        }),
        'corr-1',
      );
    });
  });

  describe('cancelOrder', () => {
    it('allows admins to cancel orders they do not own', async () => {
      (OrderRepository.findById as jest.Mock).mockResolvedValue({
        id: 'order-1',
        userId: 'customer-1',
        version: 1,
        status: OrderStatus.AWAITING_PAYMENT,
      });
      (OrderRepository.cancelOrder as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await OrderService.cancelOrder('order-1', 'admin-1', 'ADMIN', 'Admin cancelled', 'corr-1');

      expect(OrderRepository.cancelOrder).toHaveBeenCalledWith(
        'order-1',
        1,
        'Admin cancelled',
        'admin-1',
        'corr-1',
      );
    });
  });

  describe('updateOrderStatusBySeller', () => {
    it('rejects invalid seller transition from AWAITING_PAYMENT to SHIPPED', async () => {
      (OrderRepository.findById as jest.Mock).mockResolvedValue({
        id: 'order-1',
        sellerId: 'seller-1',
        version: 1,
        status: OrderStatus.AWAITING_PAYMENT,
        items: [{ sellerId: 'seller-1' }],
      });

      await expect(
        OrderService.updateOrderStatusBySeller(
          'order-1',
          'seller-1',
          'SELLER',
          OrderStatus.SHIPPED,
          undefined,
          'corr-1',
        ),
      ).rejects.toThrow('Invalid status transition');
    });

    it('allows valid seller transition from AWAITING_PAYMENT to PROCESSING', async () => {
      (OrderRepository.findById as jest.Mock).mockResolvedValue({
        id: 'order-1',
        version: 2,
        status: OrderStatus.AWAITING_PAYMENT,
        items: [{ sellerId: 'seller-1' }],
      });
      (OrderRepository.updateOrderStatus as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await OrderService.updateOrderStatusBySeller(
        'order-1',
        'seller-1',
        'SELLER',
        OrderStatus.PROCESSING,
        'Start processing',
        'corr-1',
      );

      expect(OrderRepository.updateOrderStatus).toHaveBeenCalledWith(
        'order-1',
        2,
        OrderStatus.PROCESSING,
        'Start processing',
        'seller-1',
        'corr-1',
      );
    });
  });
});
