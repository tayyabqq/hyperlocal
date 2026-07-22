/* eslint-disable no-console */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Standalone migration runner. Enables PostGIS first: the geo query path in
 * M2 depends on it, and enabling it at migrate time keeps local, CI, and
 * production identical.
 */
async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const client = postgres(url, { max: 1 });
  await client`CREATE EXTENSION IF NOT EXISTS postgis`;
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
  console.log('Migrations applied.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
