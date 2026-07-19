import crypto from 'crypto';
import { OrderStatus } from '@prisma/client';
import { Subjects } from '@teleshop/common';
import { prisma } from '../../../db/prisma';
import { OrderRepository } from '../order.repository';

describe('OrderRepository integration', () => {
  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.processedEvent.deleteMany();
    await prisma.returnRequest.deleteMany();
    await prisma.orderHistory.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
  });

  it('creates an order and writes OrderCreated to outbox', async () => {
    const order = await OrderRepository.createOrder(
      'user-1',
      {
        id: crypto.randomUUID(),
        shippingAddress: { city: 'HCM' },
        items: [
          {
            productId: crypto.randomUUID(),
            sellerId: crypto.randomUUID(),
            variantId: crypto.randomUUID(),
            quantity: 2,
            unitPrice: 150000,
          },
        ],
        couponCode: 'SAVE10',
        discountAmount: 30000,
        totalAmount: 270000,
      },
      'corr-1',
    );

    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: { subject: Subjects.OrderCreated },
    });

    expect(order.items).toHaveLength(1);
    expect(outboxEvent).not.toBeNull();

    const payload = outboxEvent?.payload as { id: string; orderId: string; userId: string };
    expect(payload.id).toBeTruthy();
    expect(payload.orderId).toBe(order.id);
    expect(payload.userId).toBe('user-1');
  });

  it('updates order to completed and writes OrderUpdated, OrderCompleted, PaymentCompleted', async () => {
    const order = await prisma.order.create({
      data: {
        id: crypto.randomUUID(),
        userId: 'user-1',
        totalAmount: 200000,
        shippingAddress: { city: 'HCM' },
        status: OrderStatus.SHIPPED,
        items: {
          create: [
            {
              productId: crypto.randomUUID(),
              sellerId: crypto.randomUUID(),
              variantId: crypto.randomUUID(),
              quantity: 1,
              unitPrice: 200000,
            },
          ],
        },
      },
      include: { items: true },
    });

    const updated = await OrderRepository.updateOrderStatus(
      order.id,
      1,
      OrderStatus.COMPLETED,
      'Delivered successfully',
      'seller-1',
      'corr-2',
    );

    expect(updated.status).toBe(OrderStatus.COMPLETED);

    const subjects = (
      await prisma.outboxEvent.findMany({
        orderBy: { createdAt: 'asc' },
      })
    ).map((event) => event.subject);

    expect(subjects).toEqual(
      expect.arrayContaining([
        Subjects.OrderUpdated,
        Subjects.OrderCompleted,
        Subjects.PaymentCompleted,
      ]),
    );
  });

  it('cancels order and writes OrderCancelled event', async () => {
    const order = await prisma.order.create({
      data: {
        id: crypto.randomUUID(),
        userId: 'user-1',
        totalAmount: 100000,
        shippingAddress: { city: 'HCM' },
        status: OrderStatus.AWAITING_PAYMENT,
        items: {
          create: [
            {
              productId: crypto.randomUUID(),
              sellerId: crypto.randomUUID(),
              variantId: crypto.randomUUID(),
              quantity: 1,
              unitPrice: 100000,
            },
          ],
        },
      },
      include: { items: true },
    });

    const canceled = await OrderRepository.cancelOrder(
      order.id,
      1,
      'Customer changed mind',
      'user-1',
      'corr-3',
    );

    expect(canceled.status).toBe(OrderStatus.CANCELLED);

    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: { subject: Subjects.OrderCancelled },
    });

    expect(outboxEvent).not.toBeNull();
  });
});
