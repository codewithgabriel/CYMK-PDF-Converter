import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const version = json('package.json').version;
assert.match(version, /^\d+\.\d+\.\d+$/);
const versions = {
  'package-lock.json': json('package-lock.json').version,
  'package-lock.json root package': json('package-lock.json').packages[''].version,
  'tauri.conf.json': json('src-tauri/tauri.conf.json').version,
  'Cargo.toml': read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
  'Cargo.lock': read('src-tauri/Cargo.lock').match(/name = "inkwell"\r?\nversion = "([^"]+)"/)?.[1],
};
for (const [name, actual] of Object.entries(versions)) {
  assert.equal(actual, version, `${name} must match package.json`);
}
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match the installer version');
}
console.log(`All package versions match: ${version}`);
