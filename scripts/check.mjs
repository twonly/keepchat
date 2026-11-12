import {readFile, readdir, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'downloads']);
assert.deepEqual(manifest.host_permissions, ['https://images.openai.com/*', 'https://www.google.com/*', 'https://*.gstatic.com/*']);
assert.ok(!manifest.content_scripts);
for (const file of await readdir('src')) if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `src/${file}`]);
for (const file of [manifest.action.default_popup, ...Object.values(manifest.icons)]) await access(file);
for (const name of ['popup', 'export']) {
  const html = await readFile(`src/${name}.html`, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, `${name}: duplicate IDs`);
  for (const match of (await readFile(`src/${name}.js`, 'utf8')).matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `${name}: missing #${match[1]}`);
}
console.log('Syntax, manifest permissions, icons and UI bindings OK.');
