// Process entry point: starts the HTTP listener and the deadline timer. (Not imported by tests,
// so tests never start a timer.)
import { app } from './app.js';
import { config } from './config.js';
import { escalationScheduler } from './scheduler/EscalationScheduler.js';

if (!config.jwt.secret) {
  console.error('JWT_SECRET is not set. Add it to server/.env (see server/.env.example) and restart.');
  process.exit(1);
}

try {
  escalationScheduler.start();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(`CampusFix server listening on http://localhost:${config.port}`);
});
