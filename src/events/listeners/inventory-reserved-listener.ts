import { Message } from 'amqplib';
import { BaseListener, QueueGroupNames, Subjects } from '@teleshop/common';
import { OrderRepository } from '../../modules/order/order.repository';
import { InboxRepository } from '../../modules/inbox/inbox.repository';
import { OrderStatus } from '@prisma/client';
import pino from 'pino';

const logger = pino({ name: 'InventoryReservedListener' });

export class InventoryReservedListener extends BaseListener<any> {
  readonly subject = Subjects.InventoryReserved;
  queueGroupName = QueueGroupNames.OrderService;

  async onMessage(data: any, _msg: Message) {
    const eventId = data.eventId;
    const correlationId = data.correlationId || 'N/A';
    const orderId = data.orderId;

    logger.info(
      { correlationId, eventId, orderId },
      'Received signal: Inventory reserved successfully',
    );

    try {
      const isProcessed = await InboxRepository.isEventProcessed(eventId);
      if (isProcessed) {
        logger.info({ correlationId, eventId }, 'Event has already been processed. Skipping.');
        return;
      }

      const order = await OrderRepository.findById(orderId);
      if (!order) {
        logger.error({ correlationId, orderId }, 'Order not found');
        throw new Error('Order not found');
      }

      // State Machine Check: Only update if currently PENDING
      if (order.status === OrderStatus.PENDING) {
        // Update status + Log history (Using OCC version)
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

      // Mark as processed
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
