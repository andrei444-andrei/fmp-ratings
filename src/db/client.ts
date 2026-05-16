import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

function makeClient() {
  const localPath = process.env.LOCAL_SQLITE_PATH;
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (localPath) {
    return createClient({ url: `file:${localPath}` });
  }
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not set (and no LOCAL_SQLITE_PATH fallback)');
  }
  return createClient({ url, authToken: token });
}

declare global {
  // eslint-disable-next-line no-var
  var __libsql_client: ReturnType<typeof makeClient> | undefined;
  // eslint-disable-next-line no-var
  var __drizzle_db: ReturnType<typeof drizzle> | undefined;
}

export const libsqlClient = globalThis.__libsql_client ?? (globalThis.__libsql_client = makeClient());
export const db = globalThis.__drizzle_db ?? (globalThis.__drizzle_db = drizzle(libsqlClient, { schema }));
export { schema };
