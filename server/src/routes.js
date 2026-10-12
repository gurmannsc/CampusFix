// All /api routes. Each milestone adds its endpoints here (docs/06 "REST API").
import { Router } from 'express';
import { asyncHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { requireRole } from './middleware/requireRole.js';
import { photoUpload } from './middleware/upload.js';
import { Role, CAMPUS_USER_ROLES } from './domain/index.js';
import { AuthController } from './controllers/AuthController.js';
import { ComplaintController } from './controllers/ComplaintController.js';
import { AssignmentController } from './controllers/AssignmentController.js';

export const router = Router();
const handler = asyncHandler;
const handlers = [Role.SUPERVISOR, Role.ADMIN]; // see AssignmentController: supervisor, or administrator for SERVICE

router.get('/health', (req, res) => {
  // Deliberately does not touch the database.
  res.json({ status: 'ok', service: 'campusfix-server', time: new Date().toISOString() });
});

// M3: authentication
router.post('/auth/login', handler(AuthController.login));
router.get('/me', authenticate, AuthController.me);

// M4: reference data for the complaint form, then complaints
router.get('/categories', authenticate, handler(ComplaintController.categories));
router.get('/locations', authenticate, handler(ComplaintController.locations));

// The role check comes before photoUpload so that anonymous requests never get their body parsed.
router.post('/complaints', requireRole(...CAMPUS_USER_ROLES), photoUpload, handler(ComplaintController.raiseComplaint));
router.get('/complaints', authenticate, handler(ComplaintController.list));
router.get('/complaints/:id', authenticate, handler(ComplaintController.details));
router.get('/complaints/:id/photo', authenticate, handler(ComplaintController.photo));
router.patch('/complaints/:id/priority', requireRole(...handlers), handler(AssignmentController.setPriority));
router.get('/complaints/:id/eligible-staff', requireRole(...handlers), handler(AssignmentController.eligibleStaff));
router.post('/complaints/:id/assign', requireRole(...handlers), handler(AssignmentController.assign));
router.post('/complaints/:id/invalid', requireRole(...handlers), handler(AssignmentController.markInvalid));
