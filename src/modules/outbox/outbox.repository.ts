import { prisma } from '../../db/prisma';

export class OutboxRepository {
  static async getPendingEvents() {
    return prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
  }

  static async markAsPublished(id: string) {
    return prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PUBLISHED', processedAt: new Date() },
    });
  }

  static async markAsFailed(id: string, errorReason: string) {
    return prisma.outboxEvent.update({
      where: { id },
      data: { status: 'FAILED', errorReason },
    });
  }
}