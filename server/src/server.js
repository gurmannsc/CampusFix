// Process entry point: starts the HTTP listener. (The scheduler is started here from M6.)
import { app } from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`CampusFix server listening on http://localhost:${config.port}`);
});
