#!/usr/bin/env node
import { migrateJsonToPostgres } from '../apps/api/src/store-pg.js';

const [jsonPath, databaseUrl] = process.argv.slice(2);
if (!jsonPath || !databaseUrl) {
  console.error('Usage: node deploy/migrate-json-to-pg.js <data/state/database.json> <DATABASE_URL>');
  process.exit(2);
}

const result = await migrateJsonToPostgres(jsonPath, databaseUrl);
console.log(JSON.stringify(result, null, 2));
