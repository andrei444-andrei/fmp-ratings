import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

function makeClient(): Client {
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
  var __libsql_client: Client | undefined;
  // eslint-disable-next-line no-var
  var __drizzle_db: LibSQLDatabase<typeof schema> | undefined;
}

function getLibsqlClient(): Client {
  if (!globalThis.__libsql_client) {
    globalThis.__libsql_client = makeClient();
  }
  return globalThis.__libsql_client;
}

function getDb(): LibSQLDatabase<typeof schema> {
  if (!globalThis.__drizzle_db) {
    globalThis.__drizzle_db = drizzle(getLibsqlClient(), { schema });
  }
  return globalThis.__drizzle_db;
}

// Lazy-прокси: реальное подключение случается при первом обращении, не на сборке.
export const libsqlClient: Client = new Proxy({} as Client, {
  get(_t, prop) {
    const c = getLibsqlClient() as any;
    const val = c[prop];
    return typeof val === 'function' ? val.bind(c) : val;
  },
});

export const db: LibSQLDatabase<typeof schema> = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_t, prop) {
    const d = getDb() as any;
    const val = d[prop];
    return typeof val === 'function' ? val.bind(d) : val;
  },
});

export { schema };
