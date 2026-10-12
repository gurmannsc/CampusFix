// Turns thrown errors into JSON responses, so controllers just throw.
// Domain errors carry their own HTTP status (400, 401, 403, 404, 409).
import { DomainError } from '../domain/index.js';

// Express 4 does not catch rejected promises from async handlers; wrap them with this.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars -- Express recognises error handlers by their 4 parameters
export function errorHandler(err, req, res, next) {
  if (err instanceof DomainError) {
    return res.status(err.httpStatus).json({ error: err.message, ...(err.details && { details: err.details }) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error(err); // unexpected: log it, but do not leak internals to the client
  return res.status(500).json({ error: 'Internal server error' });
}
