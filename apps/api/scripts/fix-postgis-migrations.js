#!/usr/bin/env node
/**
 * drizzle-kit's `customType` quotes parameterized type declarations as a
 * single literal identifier — it emits `"geography(Point,4326)"` instead of
 * `geography(Point,4326)`. The quoted form makes Postgres look for a type
 * literally named that whole string (parens, comma and all), which doesn't
 * exist, so CREATE TABLE fails outright.
 *
 * This runs after every `drizzle-kit generate` (see package.json's
 * db:generate script) and rewrites any such column so the type name and its
 * typmod parse correctly.
 */
const fs = require('node:fs');
const path = require('node:path');

const drizzleDir = path.join(__dirname, '..', 'drizzle');
const pattern = /"((?:geography|geometry)\([^)]*\))"/g;

let filesFixed = 0;

for (const file of fs.readdirSync(drizzleDir)) {
  if (!file.endsWith('.sql')) continue;
  const filePath = path.join(drizzleDir, file);
  const original = fs.readFileSync(filePath, 'utf8');
  const fixed = original.replace(pattern, '$1');
  if (fixed !== original) {
    fs.writeFileSync(filePath, fixed);
    filesFixed += 1;
    console.log(`Fixed PostGIS type quoting in ${file}`);
  }
}

if (filesFixed === 0) {
  console.log('No PostGIS type-quoting issues found.');
}
