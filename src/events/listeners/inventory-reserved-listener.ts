import { Message } from 'amqplib';
import { BaseListener, DomainEvent, QueueGroupNames, Subjects } from '@teleshop/common';
import { OrderStatus } from '@prisma/client';
import { OrderRepository } from '../../modules/order/order.repository';
import { InboxRepository } from '../../modules/inbox/inbox.repository';
import pino from 'pino';

const logger = pino({ name: 'InventoryReservedListener' });

type InventoryReservedEvent = Extract<DomainEvent, { subject: Subjects.InventoryReserved }>;

export class InventoryReservedListener extends BaseListener<InventoryReservedEvent> {
  readonly subject = Subjects.InventoryReserved;
  queueGroupName = QueueGroupNames.OrderService;

  async onMessage(data: InventoryReservedEvent['data'], _msg: Message) {
    const eventId =
      data.id || (data as InventoryReservedEvent['data'] & { eventId?: string }).eventId;
    const correlationId = data.correlationId || 'N/A';
    const { orderId } = data;

    if (!eventId || !orderId) {
      throw new Error('Invalid InventoryReserved payload: missing event identifier or orderId');
    }

    logger.info(
      { correlationId, eventId, orderId },
      'Received signal: Inventory reserved successfully',
    );

    try {
      if (await InboxRepository.isEventProcessed(eventId)) {
        logger.info({ correlationId, eventId }, 'Event has already been processed. Skipping.');
        return;
      }

      const order = await OrderRepository.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status === OrderStatus.PENDING) {
        await OrderRepository.updateOrderStatus(
          order.id,
          order.version,
          OrderStatus.AWAITING_PAYMENT,
          'Inventory confirmed. Awaiting customer payment.',
          'SYSTEM',
          correlationId,
        );
        logger.info({ correlationId, orderId }, 'Order status updated to AWAITING_PAYMENT');
      } else {
        logger.warn(
          { correlationId, orderId, status: order.status },
          'Order is not in PENDING state, skipping update',
        );
      }

      await InboxRepository.markAsProcessed(eventId, this.subject);
    } catch (error: any) {
      logger.error(
        { correlationId, eventId, err: error.message },
        'Error occurred while processing InventoryReserved event',
      );
      throw error;
    }
  }
}
