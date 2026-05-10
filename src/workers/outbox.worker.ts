import { OutboxRepository } from '../modules/outbox/outbox.repository';
import { BasePublisher, Subjects, rabbitmqWrapper } from '@teleshop/common';
import pino from 'pino';

const logger = pino();

class DynamicPublisher extends BasePublisher<any> {
  subject: Subjects;
  constructor(channel: any, subject: Subjects) {
    super(channel);
    this.subject = subject;
  }
}

export const startOutboxWorker = () => {
  logger.info('[Order Outbox Worker] Started watching for pending events...');

  setInterval(async () => {
    try {
      const events = await OutboxRepository.getPendingEvents();
      if (events.length === 0) return;

      for (const event of events) {
        try {
          const publisher = new DynamicPublisher(
            rabbitmqWrapper.channel,
            event.subject as Subjects,
          );
          await publisher.publish(event.payload as any);

          await OutboxRepository.markAsPublished(event.id);
          logger.info(`[Outbox] Successfully sent event ${event.subject} (ID: ${event.id})`);
        } catch (error: any) {
          await OutboxRepository.markAsFailed(event.id, error.message || 'Undefined error');
          logger.error(`[Outbox] Failed to send event ${event.id}`);
        }
      }
    } catch (err) {
      logger.error({ err }, '[Order Outbox Worker] Error querying Database');
    }
  }, 3000);
};
