import { OrderStatus } from '@prisma/client';
import { Subjects } from '@teleshop/common';
import { PaymentCompletedListener } from '../payment-completed-listener';
import { InboxRepository } from '../../../modules/inbox/inbox.repository';
import { OrderRepository } from '../../../modules/order/order.repository';

jest.mock('../../../modules/inbox/inbox.repository');
jest.mock('../../../modules/order/order.repository');

describe('PaymentCompletedListener', () => {
  const listener = new PaymentCompletedListener({} as any);
  const baseEvent = {
    id: 'evt-payment-completed-1',
    type: Subjects.PaymentCompleted,
    occurredAt: '2026-07-17T12:00:00.000Z',
    version: 1,
    correlationId: 'corr-order-1',
    orderId: '11111111-1111-1111-1111-111111111111',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('moves AWAITING_PAYMENT order to PROCESSING', async () => {
    (InboxRepository.isEventProcessed as jest.Mock).mockResolvedValue(false);
    (OrderRepository.findById as jest.Mock).mockResolvedValue({
      id: baseEvent.orderId,
      version: 3,
      status: OrderStatus.AWAITING_PAYMENT,
    });
    (OrderRepository.updateOrderStatus as jest.Mock).mockResolvedValue({ id: baseEvent.orderId });
    (InboxRepository.markAsProcessed as jest.Mock).mockResolvedValue(undefined);

    await listener.onMessage(baseEvent as any, {} as any);

    expect(OrderRepository.updateOrderStatus).toHaveBeenCalledWith(
      baseEvent.orderId,
      3,
      OrderStatus.PROCESSING,
      'Payment confirmed. Order is now processing.',
      'SYSTEM',
      'corr-order-1',
    );
    expect(InboxRepository.markAsProcessed).toHaveBeenCalledWith(
      baseEvent.id,
      Subjects.PaymentCompleted,
    );
  });

  it('accepts legacy eventId payload', async () => {
    (InboxRepository.isEventProcessed as jest.Mock).mockResolvedValue(false);
    (OrderRepository.findById as jest.Mock).mockResolvedValue({
      id: baseEvent.orderId,
      version: 1,
      status: OrderStatus.PROCESSING,
    });
    (InboxRepository.markAsProcessed as jest.Mock).mockResolvedValue(undefined);

    await listener.onMessage(
      {
        ...baseEvent,
        id: undefined,
        eventId: 'legacy-payment-completed-id',
      } as any,
      {} as any,
    );

    expect(InboxRepository.markAsProcessed).toHaveBeenCalledWith(
      'legacy-payment-completed-id',
      Subjects.PaymentCompleted,
    );
  });
});
