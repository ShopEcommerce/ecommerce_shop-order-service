process.env.JWT_SECRET = 'test-secret-key-for-jest';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/order_db?schema=public';

let closePrisma: () => Promise<void>;

jest.mock('@teleshop/common', () => {
  const originalModule = jest.requireActual('@teleshop/common');
  return {
    ...(originalModule as object),
    rabbitmqWrapper: {
      client: {},
      channel: {
        publish: jest.fn(),
        sendToQueue: jest.fn(),
      },
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

beforeAll(async () => {
  ({ closePrisma } = await import('../db/prisma'));
});

afterAll(async () => {
  await closePrisma();
});
