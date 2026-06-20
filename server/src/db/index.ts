import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Self-hosted Postgres (e.g. on the homelab). For a local/LAN DB, SSL is off by
// default; set DATABASE_SSL=true if your Postgres requires TLS.
export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  schema,
});
