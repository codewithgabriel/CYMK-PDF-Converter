import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const key = process.env.INKWELL_PRIVATE_API_KEY;
assert.ok(key && key.length >= 20, 'Missing private build secret');
const binary = readFileSync('src-tauri/target/release/inkwell.exe');
assert.ok(binary.includes(Buffer.from(key)), 'Private executable did not include the configured key');
console.log('Private executable contains the configured key. Its value is not logged.');
