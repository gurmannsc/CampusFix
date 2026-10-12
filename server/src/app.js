// Express application (Application layer in docs/06). Kept separate from server.js so that
// tests can import `app` with supertest without opening a network port.
import express from 'express';
import cors from 'cors';
import { config } from './config.js';

export const app = express();

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

// Health check. Deliberately does not touch the database so it works before M1 exists.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'campusfix-server', time: new Date().toISOString() });
});

// Unknown API routes return JSON rather than Express's default HTML page.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});
