import 'dotenv/config';
import { app } from './app';
import { rabbitmqWrapper } from '@teleshop/common';
import pino from 'pino';
import { InventoryReservedListener } from './events/listeners/inventory-reserved-listener';
import { InventoryFailedListener } from './events/listeners/inventory-failed-listener';
import { PaymentCompletedListener } from './events/listeners/payment-completed-listener';
import { startOutboxWorker } from './workers/outbox.worker';

const logger = pino();

const start = async () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be defined');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be defined');
  }
  if (!process.env.RABBITMQ_URL) {
    throw new Error('RABBITMQ_URL must be defined');
  }

  try {
    await rabbitmqWrapper.connect(process.env.RABBITMQ_URL);

    startOutboxWorker();

    // Graceful Shutdown
    process.on('SIGINT', () => rabbitmqWrapper.close());
    process.on('SIGTERM', () => rabbitmqWrapper.close());

    new InventoryReservedListener(rabbitmqWrapper.channel).listen();
    new InventoryFailedListener(rabbitmqWrapper.channel).listen();
    new PaymentCompletedListener(rabbitmqWrapper.channel).listen();

    const port = process.env.PORT || 3002;
    app.listen(port, () => {
      logger.info(`[Order Service] is running on port ${port}`);
    });
  } catch (err) {
    logger.error({ msg: 'Failed to start Order Service', error: err });
  }
};

start();
