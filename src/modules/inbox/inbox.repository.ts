import { prisma } from '../../db/prisma';

export class InboxRepository {
  static async isEventProcessed(eventId: string): Promise<boolean> {
    const event = await prisma.processedEvent.findUnique({
      where: { eventId },
    });
    return !!event;
  }

  static async markAsProcessed(eventId: string, subject: string) {
    await prisma.processedEvent.create({
      data: {
        eventId,
        subject,
      },
    });
  }
}
