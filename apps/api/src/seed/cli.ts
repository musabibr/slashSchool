import { loadConfig } from '../config';
import { connect } from '../db/client';
import { seedDemo } from './demo';
import { resetDatabase } from './reset';

/** npm run seed — wipes the database and loads the demo dataset. */
async function main() {
  const config = loadConfig();
  const handle = await connect(config);
  await handle.migrate();
  await resetDatabase(handle.db);
  await seedDemo(handle.db);
  await handle.close();
  console.log('Demo data loaded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
