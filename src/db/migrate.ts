import 'dotenv/config';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './client';

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Done.');
  process.exit(0);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
