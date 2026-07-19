import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';

export class InboxRepository {
  static async isEventProcessed(eventId: string): Promise<boolean> {
    const event = await prisma.processedEvent.findUnique({
      where: { eventId },
    });
    return !!event;
  }

  static async markAsProcessed(
    eventId: string,
    subject: string,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    await tx.processedEvent.upsert({
      where: { eventId },
      update: { subject },
      create: {
        eventId,
        subject,
      },
    });
  }
}
