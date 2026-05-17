import { prisma } from '../../db/prisma';
import { Prisma, OrderStatus, ReturnStatus } from '@prisma/client';
import crypto from 'crypto';
import { Subjects, BadRequestError } from '@teleshop/common';

export class OrderRepository {
  static async findById(id: string) {
    return prisma.order.findUnique({
      where: { id },
      include: { items: true, history: true },
    });
  }

  static async findByUserId(userId: string, page = 1, limit = 10) {
    const skip = (Number(page) - 1) * limit;
    return prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }

  static async findOrdersBySeller(sellerId: string, status?: OrderStatus, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    return prisma.order.findMany({
      where: {
        items: { some: { sellerId } },
        status: status,
      },
      include: {
        items: { where: { sellerId } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
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
              unitPrice: item.unitPrice,
            })),
          },
        },
        include: { items: true },
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
        },
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
        items: order.items.map((i) => ({
          productId: i.productId,
          sellerId: i.sellerId,
          variantId: i.variantId,
          quantity: i.quantity,
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

  // UPDATE ORDER STATUS WITH OCC (CONFLICT AVOIDANCE)
  static async updateOrderStatus(
    orderId: string,
    currentVersion: number, // Current version fetched from db before update
    newStatus: OrderStatus,
    note: string,
    updatedBy: string,
    correlationId?: string,
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Update status and increment version by 1
        // Prisma only updates if the `version` in the DB matches the `currentVersion` passed in
        const updatedOrder = await tx.order.update({
          where: {
            id: orderId,
            version: currentVersion,
          },
          data: {
            status: newStatus,
            version: { increment: 1 }, // Automatically increment by 1
          },
        });

        // Audit trail
        await tx.orderHistory.create({
          data: {
            orderId,
            status: newStatus,
            note,
            createdBy: updatedBy,
          },
        });

        const eventPayload = {
          eventId: crypto.randomUUID(),
          type: Subjects.OrderUpdated,
          occurredAt: new Date().toISOString(),
          correlationId,
          orderId,
          status: newStatus,
          version: updatedOrder.version,
        };

        await tx.outboxEvent.create({
          data: { subject: Subjects.OrderUpdated, payload: eventPayload as any },
        });

        if (newStatus === OrderStatus.COMPLETED) {
          const paymentCompletedPayload = {
            eventId: crypto.randomUUID(),
            type: Subjects.PaymentCompleted,
            occurredAt: new Date().toISOString(),
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

        // Send Event to notify Catalog (release inventory) and Payment (refund if applicable)
        const eventPayload = {
          eventId: crypto.randomUUID(),
          type: Subjects.OrderCancelled,
          occurredAt: new Date().toISOString(),
          orderId,
          reason,
          correlationId,
          userId: canceledOrder.userId,
          items: canceledOrder.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
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
          note: `Khách hàng yêu cầu trả hàng. Lý do: ${data.reason}`,
          createdBy: data.userId,
        },
      });

      return request;
    });
  }
}
