import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig } from './config';
import { connect } from './db/client';
import { seedDemo } from './seed/demo';
import { DEMO_SEED_VERSION } from './seed/demo-accounts';
import { ensureDemoData } from './seed/reset';

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const handle = await connect(config);
  logger.info({ driver: handle.driver }, 'database connected');
  await handle.migrate();
  logger.info('migrations applied');
  if (config.demoMode) {
    const outcome = await ensureDemoData(handle.db, (db) => seedDemo(db), DEMO_SEED_VERSION);
    logger.info({ outcome, version: DEMO_SEED_VERSION }, 'demo data checked');
  }
  const app = createApp({ db: handle.db, config, logger });
  const server = app.listen(config.port, () => logger.info({ port: config.port }, 'server listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      handle.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
