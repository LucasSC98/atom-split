import { app } from './app';
import { env } from './config/env';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Split Payment API running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated.');
  });
});

