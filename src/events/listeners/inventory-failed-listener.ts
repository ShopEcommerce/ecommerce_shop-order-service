import { Message } from 'amqplib';
import { BaseListener, DomainEvent, QueueGroupNames, Subjects } from '@teleshop/common';
import { OrderStatus } from '@prisma/client';
import { OrderRepository } from '../../modules/order/order.repository';
import { InboxRepository } from '../../modules/inbox/inbox.repository';
import pino from 'pino';

const logger = pino({ name: 'InventoryFailedListener' });

type InventoryFailedEvent = Extract<DomainEvent, { subject: Subjects.InventoryFailed }>;

export class InventoryFailedListener extends BaseListener<InventoryFailedEvent> {
  readonly subject = Subjects.InventoryFailed;
  queueGroupName = QueueGroupNames.OrderService;

  async onMessage(data: InventoryFailedEvent['data'], _msg: Message) {
    const eventId =
      data.id || (data as InventoryFailedEvent['data'] & { eventId?: string }).eventId;
    const correlationId = data.correlationId || 'N/A';
    const { orderId } = data;
    const reason = data.reason || 'Inventory reservation failed';

    if (!eventId || !orderId) {
      throw new Error('Invalid InventoryFailed payload: missing event identifier or orderId');
    }

    logger.warn(
      { correlationId, eventId, orderId },
      `Received signal: Inventory deduction failed. Reason: ${reason}`,
    );

    try {
      if (await InboxRepository.isEventProcessed(eventId)) {
        return;
      }

      const order = await OrderRepository.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status === OrderStatus.CANCELLED) {
        await InboxRepository.markAsProcessed(eventId, this.subject);
        return;
      }

      await OrderRepository.cancelOrder(
        order.id,
        order.version,
        `System automatically cancelled: ${reason}`,
        'SYSTEM',
        correlationId,
      );

      logger.info(
        { correlationId, orderId },
        'Order automatically cancelled due to stock shortage',
      );

      await InboxRepository.markAsProcessed(eventId, this.subject);
    } catch (error: any) {
      logger.error(
        { correlationId, eventId, err: error.message },
        'Error occurred while processing InventoryFailed event',
      );
      throw error;
    }
  }
}
