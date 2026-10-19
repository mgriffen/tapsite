#!/usr/bin/env node
/**
 * server.json must carry the same version as package.json.
 *
 * They drifted to 4.0.1 vs 5.2.0 — a full major version — because nothing
 * checked. `npm version` only rewrites package.json, so server.json goes stale
 * silently and the MCP registry advertises a version that was never published.
 *
 * Wired into prepublishOnly so it cannot ship out of sync.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));

const pkg = read('package.json');
const server = read('server.json');
const expected = pkg.version;

const mismatches = [];
if (server.version !== expected) {
  mismatches.push(`server.json version = ${server.version}`);
}
for (const [i, p] of (server.packages ?? []).entries()) {
  if (p.version !== expected) {
    mismatches.push(`server.json packages[${i}].version = ${p.version}`);
  }
}

if (mismatches.length) {
  console.error(`\n✖ version drift — package.json is ${expected}\n`);
  for (const m of mismatches) console.error(`    ${m}`);
  console.error(`\n  Update server.json to ${expected} before publishing.\n`);
  process.exit(1);
}

console.log(`✓ version in sync (${expected})`);
