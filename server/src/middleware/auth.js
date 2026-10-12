// JWT authentication. The token only says WHO the caller is (user id in `sub`, role as a
// convenience for the client). On every request the user is re-loaded from the database, so
// the database is the source of truth: a deleted user or a changed role takes effect at once
// and a role claim inside a token is never trusted.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { UnauthorizedError } from '../domain/index.js';
import { userRepository } from '../repositories/userRepository.js';

const ALGORITHM = 'HS256'; // pinned on verify, so "alg: none" or other algorithms are rejected

export function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwt.secret, {
    algorithm: ALGORITHM,
    subject: String(user.userId),
    expiresIn: config.jwt.expiresIn,
  });
}

// Express middleware: requires "Authorization: Bearer <token>", sets req.user to the domain User.
export async function authenticate(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedError('Authentication required');

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: [ALGORITHM] });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    const userId = Number(payload.sub);
    const user = Number.isInteger(userId) ? await userRepository.findById(userId) : null;
    if (!user) throw new UnauthorizedError('User no longer exists');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
