import 'dotenv/config';
import { libsqlClient } from './client';
import { DDL_STATEMENTS } from './ddl';

async function main() {
  for (const sql of DDL_STATEMENTS) {
    await libsqlClient.execute(sql);
  }
  console.log(`Applied ${DDL_STATEMENTS.length} DDL statements.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
