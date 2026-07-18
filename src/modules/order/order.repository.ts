import crypto from 'crypto';
import { Prisma, OrderStatus, ReturnStatus } from '@prisma/client';
import { BadRequestError, DomainEvent, Subjects } from '@teleshop/common';
import { prisma } from '../../db/prisma';

type OrderCreatedEventData = Extract<DomainEvent, { subject: Subjects.OrderCreated }>['data'];
type OrderUpdatedEventData = Extract<DomainEvent, { subject: Subjects.OrderUpdated }>['data'];
type OrderCancelledEventData = Extract<DomainEvent, { subject: Subjects.OrderCancelled }>['data'];
type OrderCompletedEventData = Extract<DomainEvent, { subject: Subjects.OrderCompleted }>['data'];
type PaymentCompletedEventData = Extract<
  DomainEvent,
  { subject: Subjects.PaymentCompleted }
>['data'];

export class OrderRepository {
  static async findById(id: string) {
    return prisma.order.findUnique({
      where: { id },
      include: { items: true, history: true },
    });
  }

  static async findByUserId(userId: string, page = 1, limit = 10) {
    const currentPage = Number(page) || 1;
    const currentLimit = Number(limit) || 10;
    const skip = (currentPage - 1) * currentLimit;

    const [data, total] = await prisma.$transaction([
      prisma.order.findMany({
        where: { userId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: currentLimit,
      }),
      prisma.order.count({
        where: { userId },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages: Math.ceil(total / currentLimit),
      },
    };
  }

  static async findSellerOrders(
    sellerId: string,
    opts: {
      page?: number;
      limit?: number;
      status?: OrderStatus;
      search?: string;
    } = {},
  ) {
    const page = opts.page || 1;
    const limit = opts.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      items: { some: { sellerId } },
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.search
        ? {
            OR: [{ id: { contains: opts.search } }, { userId: { contains: opts.search } }],
          }
        : {}),
    };

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        include: {
          items: { where: { sellerId } },
          history: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return { data: orders, total };
  }

  static async findSellerCancellations(
    sellerId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
    } = {},
  ) {
    return this.findSellerOrders(sellerId, {
      page: opts.page,
      limit: opts.limit,
      search: opts.search,
      status: OrderStatus.CANCELLED,
    });
  }

  static async findReturnRequestsBySeller(
    sellerId: string,
    opts: {
      page?: number;
      limit?: number;
      status?: ReturnStatus;
      search?: string;
    } = {},
  ) {
    const page = opts.page || 1;
    const limit = opts.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnRequestWhereInput = {
      order: { items: { some: { sellerId } } },
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.search
        ? {
            OR: [
              { id: { contains: opts.search } },
              { orderId: { contains: opts.search } },
              { userId: { contains: opts.search } },
            ],
          }
        : {}),
    };

    const [returns, total] = await prisma.$transaction([
      prisma.returnRequest.findMany({
        where,
        include: {
          order: {
            include: {
              items: { where: { sellerId } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.returnRequest.count({ where }),
    ]);

    return { data: returns, total };
  }

  static async findSellerReturnById(id: string, sellerId: string) {
    return prisma.returnRequest.findFirst({
      where: {
        id,
        order: {
          items: { some: { sellerId } },
        },
      },
      include: {
        order: {
          include: {
            items: { where: { sellerId } },
            history: true,
          },
        },
      },
    });
  }

  static async updateReturnStatus(
    returnRequestId: string,
    status: ReturnStatus,
    adminNote: string | undefined,
    updatedBy: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.returnRequest.update({
        where: { id: returnRequestId },
        data: { status, adminNote },
        include: { order: true },
      });

      if (status === ReturnStatus.REJECTED) {
        await tx.order.update({
          where: { id: updated.orderId },
          data: { status: OrderStatus.COMPLETED },
        });

        await tx.orderHistory.create({
          data: {
            orderId: updated.orderId,
            status: OrderStatus.COMPLETED,
            note: `Return request rejected${adminNote ? `. Note: ${adminNote}` : ''}`,
            createdBy: updatedBy,
          },
        });
      }

      if (status === ReturnStatus.REFUNDED) {
        await tx.order.update({
          where: { id: updated.orderId },
          data: { status: OrderStatus.RETURNED },
        });

        await tx.orderHistory.create({
          data: {
            orderId: updated.orderId,
            status: OrderStatus.RETURNED,
            note: `Return request refunded${adminNote ? `. Note: ${adminNote}` : ''}`,
            createdBy: updatedBy,
          },
        });
      }

      if (status === ReturnStatus.APPROVED) {
        await tx.orderHistory.create({
          data: {
            orderId: updated.orderId,
            status: OrderStatus.RETURN_REQUESTED,
            note: `Return request approved${adminNote ? `. Note: ${adminNote}` : ''}`,
            createdBy: updatedBy,
          },
        });
      }

      return updated;
    });
  }

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
              unitPrice: item.unitPrice,
            })),
          },
        },
        include: { items: true },
      });

      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PENDING,
          note: data.couponCode
            ? `Order created with coupon [${data.couponCode}]. Awaiting inventory check.`
            : 'Order created. Awaiting inventory check.',
          createdBy: userId,
        },
      });

      const eventPayload: OrderCreatedEventData = {
        id: crypto.randomUUID(),
        type: Subjects.OrderCreated,
        occurredAt: new Date().toISOString(),
        version: 1,
        correlationId,
        orderId: order.id,
        userId,
        items: order.items.map((item) => ({
          productId: item.productId,
          sellerId: item.sellerId,
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      };

      await tx.outboxEvent.create({
        data: {
          subject: Subjects.OrderCreated,
          payload: eventPayload as any,
        },
      });

      return order;
    });
  }

  static async updateOrderStatus(
    orderId: string,
    currentVersion: number,
    newStatus: OrderStatus,
    note: string,
    updatedBy: string,
    correlationId?: string,
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: {
            id: orderId,
            version: currentVersion,
          },
          data: {
            status: newStatus,
            version: { increment: 1 },
          },
          include: {
            items: true,
          },
        });

        await tx.orderHistory.create({
          data: {
            orderId,
            status: newStatus,
            note,
            createdBy: updatedBy,
          },
        });

        const eventPayload: OrderUpdatedEventData = {
          id: crypto.randomUUID(),
          type: Subjects.OrderUpdated,
          occurredAt: new Date().toISOString(),
          version: updatedOrder.version,
          correlationId,
          orderId,
          status: newStatus,
        };

        await tx.outboxEvent.create({
          data: { subject: Subjects.OrderUpdated, payload: eventPayload as any },
        });

        if (newStatus === OrderStatus.COMPLETED) {
          const orderCompletedPayload: OrderCompletedEventData = {
            id: crypto.randomUUID(),
            type: Subjects.OrderCompleted,
            occurredAt: new Date().toISOString(),
            version: 1,
            correlationId,
            orderId,
            userId: updatedOrder.userId,
            items: updatedOrder.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          };

          await tx.outboxEvent.create({
            data: { subject: Subjects.OrderCompleted, payload: orderCompletedPayload as any },
          });

          const paymentCompletedPayload: PaymentCompletedEventData = {
            id: crypto.randomUUID(),
            type: Subjects.PaymentCompleted,
            occurredAt: new Date().toISOString(),
            version: 1,
            correlationId,
            orderId,
          };

          await tx.outboxEvent.create({
            data: { subject: Subjects.PaymentCompleted, payload: paymentCompletedPayload as any },
          });
        }

        return updatedOrder;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestError(
          'Update failed: Order has been modified by another process (Conflict).',
        );
      }
      throw error;
    }
  }

  static async cancelOrder(
    orderId: string,
    currentVersion: number,
    reason: string,
    updatedBy: string,
    correlationId?: string,
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const canceledOrder = await tx.order.update({
          where: { id: orderId, version: currentVersion },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: reason,
            canceledAt: new Date(),
            version: { increment: 1 },
          },
          include: { items: true },
        });

        await tx.orderHistory.create({
          data: {
            orderId,
            status: OrderStatus.CANCELLED,
            note: `Cancel order. Reason: ${reason}`,
            createdBy: updatedBy,
          },
        });

        const eventPayload: OrderCancelledEventData = {
          id: crypto.randomUUID(),
          type: Subjects.OrderCancelled,
          occurredAt: new Date().toISOString(),
          version: 1,
          orderId,
          reason,
          correlationId,
          userId: canceledOrder.userId,
          items: canceledOrder.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        };

        await tx.outboxEvent.create({
          data: { subject: Subjects.OrderCancelled, payload: eventPayload as any },
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

  static async createReturnRequest(data: {
    orderId: string;
    userId: string;
    reason: string;
    amount: number;
  }) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.returnRequest.create({
        data: {
          orderId: data.orderId,
          userId: data.userId,
          reason: data.reason,
          refundAmount: data.amount,
          status: ReturnStatus.PENDING,
        },
      });

      await tx.order.update({
        where: { id: data.orderId },
        data: { status: OrderStatus.RETURN_REQUESTED },
      });

      await tx.orderHistory.create({
        data: {
          orderId: data.orderId,
          status: OrderStatus.RETURN_REQUESTED,
          note: `Customer requested a return. Reason: ${data.reason}`,
          createdBy: data.userId,
        },
      });

      return request;
    });
  }
}
