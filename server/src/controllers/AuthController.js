// POST /api/auth/login and GET /api/me
import bcrypt from 'bcrypt';
import { DomainError, ValidationError } from '../domain/index.js';
import { userRepository } from '../repositories/userRepository.js';
import { signToken } from '../middleware/auth.js';

// Used when the email is unknown, so that case takes as long as a wrong password and the
// response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const AuthController = {
  async login(req, res) {
    const { email, password } = req.body ?? {};
    // typeof checks also stop non-string values (e.g. objects) from reaching the query.
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw new ValidationError('email and password are required');
    }
    const user = await userRepository.findByEmail(email.trim());

    // User.login(email, password) from the class diagram does the bcrypt comparison.
    const ok = user ? await user.login(email.trim(), password) : (await bcrypt.compare(password, DUMMY_HASH), false);
    // One message for both cases, so the API does not reveal whether the email exists.
    if (!ok) throw new DomainError('Invalid email or password', 401);

    res.json({ token: signToken(user), user }); // user.toJSON() leaves out the password hash
  },

  me(req, res) {
    res.json({ user: req.user });
  },
};
