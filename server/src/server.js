// Process entry point: starts the HTTP listener. (The scheduler is started here from M6.)
import { app } from './app.js';
import { config } from './config.js';

if (!config.jwt.secret) {
  console.error('JWT_SECRET is not set. Add it to server/.env (see server/.env.example) and restart.');
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(`CampusFix server listening on http://localhost:${config.port}`);
});
