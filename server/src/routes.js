// All /api routes. Each milestone adds its endpoints here (docs/06 "REST API").
import { Router } from 'express';
import { asyncHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { AuthController } from './controllers/AuthController.js';

export const router = Router();

router.get('/health', (req, res) => {
  // Deliberately does not touch the database.
  res.json({ status: 'ok', service: 'campusfix-server', time: new Date().toISOString() });
});

router.post('/auth/login', asyncHandler(AuthController.login));
router.get('/me', authenticate, AuthController.me);
