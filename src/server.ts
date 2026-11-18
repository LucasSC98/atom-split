import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/database';

const PORT = Number(env.PORT) || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Split Payment API running on port ${PORT} [${env.NODE_ENV}]`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received. Closing HTTP server...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('Database disconnected. Process terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));