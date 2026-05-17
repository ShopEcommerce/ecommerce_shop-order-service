import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be defined');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ids = {
  order: '00000000-0000-0000-0000-000000000401',
  itemPhone: '00000000-0000-0000-0000-000000000402',
  itemLaptop: '00000000-0000-0000-0000-000000000403',
  historyCreated: '00000000-0000-0000-0000-000000000404',
  historyCompleted: '00000000-0000-0000-0000-000000000405',
};

async function main() {
  logger.info('Seeding Order Service Database...');

  await prisma.outboxEvent.deleteMany({});
  await prisma.processedEvent.deleteMany({});
  await prisma.returnRequest.deleteMany({});
  await prisma.orderHistory.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});

  const order = await prisma.order.create({
    data: {
      id: ids.order,
      userId: '00000000-0000-0000-0000-000000000003',
      status: 'COMPLETED',
      totalAmount: new Prisma.Decimal('45480000'),
      shippingAddress: {
        receiverName: 'Teleshop Customer',
        receiverPhone: '0900000003',
        street: '123 Nguyen Trai',
        ward: 'Ben Thanh',
        district: 'District 1',
        city: 'Ho Chi Minh City',
      },
      couponCode: 'WELCOME10',
      discountAmount: new Prisma.Decimal('500000'),
      items: {
        create: [
          {
            id: ids.itemPhone,
            productId: '00000000-0000-0000-0000-000000000201',
            sellerId: '00000000-0000-0000-0000-000000000002',
            variantId: '00000000-0000-0000-0000-000000000301',
            quantity: 1,
            unitPrice: new Prisma.Decimal('18990000'),
          },
          {
            id: ids.itemLaptop,
            productId: '00000000-0000-0000-0000-000000000202',
            sellerId: '00000000-0000-0000-0000-000000000002',
            variantId: '00000000-0000-0000-0000-000000000303',
            quantity: 1,
            unitPrice: new Prisma.Decimal('26990000'),
          },
        ],
      },
      history: {
        create: [
          {
            id: ids.historyCreated,
            status: 'PENDING',
            note: 'Seed order created',
            createdBy: 'system',
          },
          {
            id: ids.historyCompleted,
            status: 'COMPLETED',
            note: 'Seed order completed',
            createdBy: 'system',
          },
        ],
      },
    },
  });

  logger.info({ orderId: order.id }, 'Order seed complete: one completed order with history created.');
}

main()
  .catch((error) => {
    logger.error(error);
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
