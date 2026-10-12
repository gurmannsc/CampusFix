// Express application (Application layer in docs/06). Kept separate from server.js so that
// tests can import `app` with supertest without opening a network port.
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router } from './routes.js';
import { errorHandler } from './middleware/errorHandler.js';

export const app = express();

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

app.use('/api', router);

// Unknown API routes return JSON rather than Express's default HTML page.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);
