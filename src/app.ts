import express, { RequestHandler, ErrorRequestHandler } from 'express';
import cookieSession from 'cookie-session';
import cors from 'cors';
import { errorHandler, NotFoundError, correlationId, currentUser } from '@teleshop/common';
import { orderRouter } from './modules/order/order.route';

const app = express();

app.set('trust proxy', true);

app.use(
  cors({
    origin: true, 
    credentials: true, 
  })
);

app.use(express.json());

app.use(correlationId as RequestHandler);

app.get('/health', (_req, res) => {
  res.status(200).send({ status: 'ok', service: 'order-service' });
});

app.use(
  cookieSession({
    signed: false,
    secure: process.env.NODE_ENV === 'production', 
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  })
);

app.use(currentUser as RequestHandler);

app.use('/api/orders', orderRouter);

app.all(/.*/, () => {
  throw new NotFoundError();
});

app.use(errorHandler as ErrorRequestHandler);

export { app };