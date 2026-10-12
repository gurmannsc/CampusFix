// requireRole('ADMIN') or requireRole('STUDENT', 'FACULTY'): protects a route.
// Returns [authenticate, roleCheck] so one call is enough:
//   router.get('/dashboard', requireRole(Role.ADMIN), handler)
// A missing or bad token gives 401; a valid user with the wrong role gives 403.
import { Role, ForbiddenActionError } from '../domain/index.js';
import { authenticate } from './auth.js';

export function requireRole(...roles) {
  // Catch typos such as requireRole('Admin') when the route is defined, not when it is first hit.
  if (roles.length === 0 || !roles.every((r) => Object.values(Role).includes(r))) {
    throw new Error(`requireRole needs one or more of ${Object.values(Role).join(', ')} (got: ${roles.join(', ') || 'nothing'})`);
  }
  const roleCheck = (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    return next(new ForbiddenActionError(`This action requires the role ${roles.join(' or ')}`));
  };
  return [authenticate, roleCheck];
}
