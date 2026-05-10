import { OrderRepository } from './order.repository';
import { BadRequestError, NotFoundError, ForbiddenError } from '@teleshop/common';
import { OrderStatus } from '@prisma/client';
import axios from 'axios';

export class OrderService {
  
  static async createOrder(
    userId: string, 
    data: any, 
    token?: string,
    correlationId?: string
  ) {
    // Get variant IDs from order items
    const variantIds = data.items.map((i: any) => i.variantId);

    // Call Catalog Service to validate prices (This prevents price manipulation from frontend)
    const catalogResponse = await axios.post('http://catalog-service:3003/api/catalog/products/validate-prices', {
      variantIds
    });
    
    const verifiedPrices = catalogResponse.data; 

    const validatedItems = data.items.map((item: any) => {
      const actualPrice = verifiedPrices[item.variantId];
      if (!actualPrice) throw new BadRequestError(`Product ${item.variantId} is no longer available`);
      
      return {
        ...item,
        unitPrice: actualPrice
      };
    });

    const subTotal = validatedItems.reduce((acc: number, item: any) => acc + (item.unitPrice * item.quantity), 0);

    const orderId = crypto.randomUUID();
    let discountAmount = 0;
    const couponCode = data.couponCode;

    // Call Promotion Service to reserve coupon code
    if (couponCode) {
      try {
        const response = await axios.post('http://localhost:3008/api/promotions/coupons/reserve', {
          code: couponCode,
          orderId: orderId,
          orderAmount: subTotal
        }, {
          headers: { Authorization: token }
        });

        const coupon = response.data.data.coupon;
        
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = (subTotal * Number(coupon.discountValue)) / 100;
        } else {
          discountAmount = Number(coupon.discountValue);
        }
      } catch (error: any) {
        const errorMessage = error.response?.data?.errors?.[0]?.message || error.response?.data?.message || 'Error applying coupon code';
        throw new BadRequestError(errorMessage);
      }
    }

    const finalTotalAmount = Math.max(0, subTotal - discountAmount);

    return OrderRepository.createOrder(userId, {
      ...data,
      id: orderId,
      items: validatedItems,
      couponCode: couponCode || null,
      discountAmount,
      totalAmount: finalTotalAmount
    }, correlationId);
  }

  static async cancelOrder(
    orderId: string, 
    userId: string, 
    role: string, 
    reason: string, 
    correlationId?: string
  ) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (order.userId !== userId && role !== 'SELLER') {
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

    return OrderRepository.cancelOrder(orderId, order.version, reason, userId);
  }


  static async requestReturn(
    orderId: string, 
    userId: string, 
    reason: string
  ) {
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
      userId: userId,
      reason: reason,
      amount: Number(order.totalAmount)
    });
  }

  static async getOrderById(orderId: string, userId: string, role: string) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (order.userId !== userId && role !== 'ADMIN' && role !== 'SELLER') {
      throw new ForbiddenError('You do not have permission to access this order');
    }

    return order;
  }

  static async getCustomerOrders(userId: string, page: number, limit: number) {
    return OrderRepository.findByUserId(userId, page, limit);
  }
}