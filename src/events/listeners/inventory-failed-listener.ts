import { Message } from 'amqplib';
import { BaseListener, QueueGroupNames, Subjects } from '@teleshop/common';
import { OrderRepository } from '../../modules/order/order.repository';
import { InboxRepository } from '../../modules/inbox/inbox.repository';
import pino from 'pino';

const logger = pino({ name: 'InventoryFailedListener' });

export class InventoryFailedListener extends BaseListener<any> {
  subject: any = 'InventoryFailed'; 
  queueGroupName = QueueGroupNames.OrderService;

  async onMessage(data: any, msg: Message) {
    const eventId = data.eventId;
    const correlationId = data.correlationId || 'N/A';
    const orderId = data.orderId;
    const reason = data.reason || 'English: Out of stock';

    logger.warn({ correlationId, eventId, orderId }, `Received signal: Inventory deduction failed. Reason: ${reason}`);

    try {
      const isProcessed = await InboxRepository.isEventProcessed(eventId);
      if (isProcessed) {
        return; 
      }

      const order = await OrderRepository.findById(orderId);
      if (!order) {
        throw new Error('Order not found'); 
      }

      await OrderRepository.cancelOrder(
        order.id, 
        order.version, 
        `System automatically cancelled: ${reason}`, 
        'SYSTEM'
      );

      logger.info({ correlationId, orderId }, 'Order automatically cancelled due to stock shortage');

      await InboxRepository.markAsProcessed(eventId, this.subject);

    } catch (error: any) {
      logger.error({ correlationId, eventId, err: error.message }, 'Error occurred while processing InventoryFailed event');
      throw error;
    }
  }
}