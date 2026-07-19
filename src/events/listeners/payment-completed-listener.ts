import { Message } from 'amqplib';
import { BaseListener, DomainEvent, QueueGroupNames, Subjects } from '@teleshop/common';
import { OrderStatus } from '@prisma/client';
import { OrderRepository } from '../../modules/order/order.repository';
import { InboxRepository } from '../../modules/inbox/inbox.repository';
import pino from 'pino';

const logger = pino({ name: 'PaymentCompletedListener' });

type PaymentCompletedEvent = Extract<DomainEvent, { subject: Subjects.PaymentCompleted }>;

export class PaymentCompletedListener extends BaseListener<PaymentCompletedEvent> {
  readonly subject = Subjects.PaymentCompleted;
  queueGroupName = QueueGroupNames.OrderService;

  async onMessage(data: PaymentCompletedEvent['data'], _msg: Message) {
    const eventId =
      data.id || (data as PaymentCompletedEvent['data'] & { eventId?: string }).eventId;
    const correlationId = data.correlationId || 'N/A';
    const { orderId } = data;

    if (!eventId || !orderId) {
      throw new Error('Invalid PaymentCompleted payload: missing event identifier or orderId');
    }

    logger.info({ correlationId, eventId, orderId }, 'Received signal: Payment completed');

    try {
      if (await InboxRepository.isEventProcessed(eventId)) {
        return;
      }

      const order = await OrderRepository.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status === OrderStatus.AWAITING_PAYMENT) {
        await OrderRepository.updateOrderStatus(
          order.id,
          order.version,
          OrderStatus.PROCESSING,
          'Payment confirmed. Order is now processing.',
          'SYSTEM',
          correlationId,
        );
      }

      await InboxRepository.markAsProcessed(eventId, this.subject);
    } catch (error: any) {
      logger.error(
        { correlationId, eventId, err: error.message },
        'Error occurred while processing PaymentCompleted event',
      );
      throw error;
    }
  }
}
