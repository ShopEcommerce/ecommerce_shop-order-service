import { prisma } from '../../db/prisma';
import { Prisma, OrderStatus, ReturnStatus } from '@prisma/client';
import crypto from 'crypto';
import { Subjects, BadRequestError } from '@teleshop/common';
import { CreateOrderInput } from './order.schema';

export class OrderRepository {

  static async findById(id: string) {
    return prisma.order.findUnique({
      where: { id },
      include: { items: true, history: true }
    });
  }

  static async findByUserId(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    return prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });
  }

  static async findOrdersBySeller(sellerId: string, status?: OrderStatus, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    return prisma.order.findMany({
      where: {
        items: { some: { sellerId } },
        status: status
      },
      include: { 
        items: { where: { sellerId } }
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
  }

  // CREATE ORDER (SAGA INITIATOR)
  static async createOrder(userId: string, data: any, correlationId?: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: data.id,
          userId,
          totalAmount: data.totalAmount,
          couponCode: data.couponCode,
          discountAmount: data.discountAmount,
          shippingAddress: data.shippingAddress as Prisma.InputJsonValue,
          status: OrderStatus.PENDING,
          
          items: {
            create: data.items.map((item: any) => ({
              productId: item.productId,
              sellerId: item.sellerId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice
            }))
          }
        },
        include: { items: true }
      });

      // Audit Trail
      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PENDING,
          note: data.couponCode 
            ? `Order created with coupon [${data.couponCode}]. Awaiting inventory check.` 
            : 'Order created. Awaiting inventory check.',
          createdBy: userId,
        }
      });

      // Send Event Outbox (active flow Saga)
      // Catalog Service will listen to this event and start reducing inventory
      const eventPayload = {
        eventId: crypto.randomUUID(),
        type: Subjects.OrderCreated,
        occurredAt: new Date().toISOString(),
        correlationId,
        orderId: order.id,
        userId: userId,
        items: order.items.map(i => ({
          productId: i.productId,
          sellerId: i.sellerId,
          variantId: i.variantId,
          quantity: i.quantity
        }))
      };

      await tx.outboxEvent.create({
        data: {
          subject: Subjects.OrderCreated,
          payload: eventPayload as any,
        }
      });

      return order;
    });
  }

  // UPDATE ORDER STATUS WITH OCC (CONFLICT AVOIDANCE)
  static async updateOrderStatus(
    orderId: string, 
    currentVersion: number, // Current version fetched from db before update
    newStatus: OrderStatus, 
    note: string, 
    updatedBy: string, 
    correlationId?: string
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Update status and increment version by 1
        // Prisma only updates if the `version` in the DB matches the `currentVersion` passed in
        const updatedOrder = await tx.order.update({
          where: { 
            id: orderId,
            version: currentVersion 
          },
          data: {
            status: newStatus,
            version: { increment: 1 } // Automatically increment by 1
          }
        });

        // Audit trail
        await tx.orderHistory.create({
          data: {
            orderId,
            status: newStatus,
            note,
            createdBy: updatedBy
          }
        });

        const eventPayload = {
          eventId: crypto.randomUUID(),
          type: Subjects.OrderUpdated,
          occurredAt: new Date().toISOString(),
          correlationId,
          orderId,
          status: newStatus,
          version: updatedOrder.version
        };

        await tx.outboxEvent.create({
          data: { subject: Subjects.OrderUpdated, payload: eventPayload as any }
        });

        return updatedOrder;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestError('Update failed: Order has been modified by another process (Conflict).');
      }
      throw error;
    }
  }

  static async cancelOrder(orderId: string, currentVersion: number, reason: string, updatedBy: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const canceledOrder = await tx.order.update({
          where: { id: orderId, version: currentVersion },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: reason,
            canceledAt: new Date(),
            version: { increment: 1 }
          }
        });

        await tx.orderHistory.create({
          data: {
            orderId,
            status: OrderStatus.CANCELLED,
            note: `Cancel order. Reason: ${reason}`,
            createdBy: updatedBy
          }
        });

        // Send Event to notify Catalog (release inventory) and Payment (refund if applicable)
        const eventPayload = {
          eventId: crypto.randomUUID(),
          type: Subjects.OrderCancelled,
          occurredAt: new Date().toISOString(),
          orderId,
          reason
        };

        await tx.outboxEvent.create({
          data: { subject: Subjects.OrderCancelled, payload: eventPayload as any }
        });

        return canceledOrder;
      });
    } catch (error) {
       if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestError('Order has been modified by another process (Conflict).');
      }
      throw error;
    }
  }

  static async createReturnRequest(data: { orderId: string; userId: string; reason: string; amount: number }) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.returnRequest.create({
        data: {
          orderId: data.orderId,
          userId: data.userId,
          reason: data.reason,
          refundAmount: data.amount,
          status: ReturnStatus.PENDING
        }
      });

      await tx.order.update({
        where: { id: data.orderId },
        data: { status: OrderStatus.RETURN_REQUESTED }
      });

      await tx.orderHistory.create({
        data: {
          orderId: data.orderId,
          status: OrderStatus.RETURN_REQUESTED,
          note: `Khách hàng yêu cầu trả hàng. Lý do: ${data.reason}`,
          createdBy: data.userId
        }
      });

      return request;
    });
  }
}