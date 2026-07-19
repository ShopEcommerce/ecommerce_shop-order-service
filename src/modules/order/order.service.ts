import crypto from 'crypto';
import axios from 'axios';
import { OrderStatus, ReturnStatus } from '@prisma/client';
import { BadRequestError, ForbiddenError, NotFoundError } from '@teleshop/common';
import { OrderRepository } from './order.repository';

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3003';
const PROMOTION_SERVICE_URL = process.env.PROMOTION_SERVICE_URL || 'http://localhost:3008';

const SELLER_ALLOWED_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.COMPLETED],
};

export class OrderService {
  static async createOrder(userId: string, data: any, token?: string, correlationId?: string) {
    const variantIds = data.items.map((item: any) => item.variantId);
    const authHeader = token
      ? token.startsWith('Bearer ')
        ? token
        : `Bearer ${token}`
      : undefined;

    let verifiedPrices: Record<string, number>;
    try {
      const catalogResponse = await axios.post(
        `${CATALOG_SERVICE_URL}/api/product/validate-prices`,
        { variantIds },
        {
          headers: {
            ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
          },
        },
      );

      verifiedPrices = catalogResponse.data;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.errors?.[0]?.message ||
        error.response?.data?.message ||
        'Unable to validate product prices';
      throw new BadRequestError(errorMessage);
    }

    const validatedItems = data.items.map((item: any) => {
      const actualPrice = verifiedPrices[item.variantId];
      if (!actualPrice) {
        throw new BadRequestError(`Product ${item.variantId} is no longer available`);
      }

      return {
        ...item,
        unitPrice: actualPrice,
      };
    });

    const subTotal = validatedItems.reduce(
      (acc: number, item: any) => acc + item.unitPrice * item.quantity,
      0,
    );

    const orderId = crypto.randomUUID();
    let discountAmount = 0;
    const couponCode = data.couponCode;

    if (couponCode) {
      try {
        const response = await axios.post(
          `${PROMOTION_SERVICE_URL}/api/promotions/coupons/reserve`,
          {
            code: couponCode,
            orderId,
            orderAmount: subTotal,
          },
          {
            headers: {
              ...(authHeader ? { Authorization: authHeader } : {}),
              ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
            },
          },
        );

        const coupon = response.data.data.coupon;

        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = (subTotal * Number(coupon.discountValue)) / 100;
        } else {
          discountAmount = Number(coupon.discountValue);
        }
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.errors?.[0]?.message ||
          error.response?.data?.message ||
          'Error applying coupon code';
        throw new BadRequestError(errorMessage);
      }
    }

    const finalTotalAmount = Math.max(0, subTotal - discountAmount);

    return OrderRepository.createOrder(
      userId,
      {
        ...data,
        id: orderId,
        items: validatedItems,
        couponCode: couponCode || null,
        discountAmount,
        totalAmount: finalTotalAmount,
      },
      correlationId,
    );
  }

  static async cancelOrder(
    orderId: string,
    userId: string,
    role: string,
    reason: string,
    correlationId?: string,
  ) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (order.userId !== userId && role !== 'SELLER' && role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to cancel this order');
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.RETURNED
    ) {
      throw new BadRequestError(`Cannot cancel order in state: ${order.status}`);
    }

    return OrderRepository.cancelOrder(orderId, order.version, reason, userId, correlationId);
  }

  static async requestReturn(orderId: string, userId: string, reason: string) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (order.userId !== userId) {
      throw new ForbiddenError('Only the customer can request a return');
    }

    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestError('Only completed orders can be returned');
    }

    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const timeSinceCompletion = new Date().getTime() - new Date(order.updatedAt).getTime();

    if (timeSinceCompletion > SEVEN_DAYS) {
      throw new BadRequestError('Order is outside the return window');
    }

    return OrderRepository.createReturnRequest({
      orderId: order.id,
      userId,
      reason,
      amount: Number(order.totalAmount),
    });
  }

  static async getOrderById(orderId: string, userId: string, role: string) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (role === 'ADMIN') {
      return order;
    }

    if (role === 'SELLER') {
      const ownsOrder = order.items.some((item) => item.sellerId === userId);
      if (!ownsOrder) {
        throw new ForbiddenError('You do not have permission to access this order');
      }
      return order;
    }

    if (order.userId !== userId) {
      throw new ForbiddenError('You do not have permission to access this order');
    }

    return order;
  }

  static async getCustomerOrders(userId: string, page: number, limit: number) {
    return OrderRepository.findByUserId(userId, page, limit);
  }

  static async getSellerOrders(
    sellerId: string,
    page: number,
    limit: number,
    status?: OrderStatus,
    search?: string,
  ) {
    return OrderRepository.findSellerOrders(sellerId, { page, limit, status, search });
  }

  static async getSellerCancellations(
    sellerId: string,
    page: number,
    limit: number,
    search?: string,
  ) {
    return OrderRepository.findSellerCancellations(sellerId, { page, limit, search });
  }

  static async updateOrderStatusBySeller(
    orderId: string,
    sellerId: string,
    role: string,
    nextStatus: OrderStatus,
    note?: string,
    correlationId?: string,
  ) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    const ownsOrder = order.items.some((item) => item.sellerId === sellerId);
    if (!ownsOrder && role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to update this order');
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.RETURNED ||
      order.status === OrderStatus.COMPLETED
    ) {
      throw new BadRequestError(`Cannot update order in state: ${order.status}`);
    }

    const allowedTransitions = SELLER_ALLOWED_STATUS_TRANSITIONS[order.status] || [];
    if (!allowedTransitions.includes(nextStatus)) {
      throw new BadRequestError(`Invalid status transition from ${order.status} to ${nextStatus}`);
    }

    if (nextStatus === OrderStatus.CANCELLED) {
      return this.cancelOrder(
        orderId,
        sellerId,
        role,
        note || 'Seller cancelled order from dashboard',
        correlationId,
      );
    }

    if (nextStatus === OrderStatus.RETURNED) {
      throw new BadRequestError('Use return request workflow to mark order as returned');
    }

    return OrderRepository.updateOrderStatus(
      orderId,
      order.version,
      nextStatus,
      note || `Order status updated to ${nextStatus}`,
      sellerId,
      correlationId,
    );
  }

  static async getSellerReturns(
    sellerId: string,
    page: number,
    limit: number,
    status?: ReturnStatus,
    search?: string,
  ) {
    return OrderRepository.findReturnRequestsBySeller(sellerId, {
      page,
      limit,
      status,
      search,
    });
  }

  static async getSellerReturnById(returnRequestId: string, sellerId: string) {
    const request = await OrderRepository.findSellerReturnById(returnRequestId, sellerId);
    if (!request) throw new NotFoundError('Return request not found');
    return request;
  }

  static async updateSellerReturnStatus(
    returnRequestId: string,
    sellerId: string,
    status: ReturnStatus,
    adminNote?: string,
  ) {
    const request = await OrderRepository.findSellerReturnById(returnRequestId, sellerId);
    if (!request) throw new NotFoundError('Return request not found');

    if (request.status === ReturnStatus.REJECTED || request.status === ReturnStatus.REFUNDED) {
      throw new BadRequestError(`Cannot update return request in state: ${request.status}`);
    }

    if (status === ReturnStatus.REFUNDED && request.status !== ReturnStatus.APPROVED) {
      throw new BadRequestError('Return must be approved before refunding');
    }

    return OrderRepository.updateReturnStatus(returnRequestId, status, adminNote, sellerId);
  }
}
