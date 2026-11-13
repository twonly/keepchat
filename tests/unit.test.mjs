import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHTML, buildMarkdown, fileName, isChatURL, escapeHTML} from '../src/archive.js';
import {isAllowedImageURL, createAssetService} from '../src/assets.js';
test('image bridge only accepts known HTTPS image endpoints and the active job', () => {
  for (const url of ['https://images.openai.com/static-rsc-4/a', 'https://www.google.com/s2/favicons?domain=example.com', 'https://t0.gstatic.com/faviconV2?a']) assert.ok(isAllowedImageURL(url));
  for (const url of ['http://images.openai.com/a', 'https://images.openai.com.evil.test/a', 'https://www.google.com/search?q=secret', 'https://www.gstatic.com/other', 'https://user:pass@images.openai.com/a', 'https://images.openai.com:8443/a', 'file:///a', 'data:image/png,xxx']) assert.equal(isAllowedImageURL(url), false);
  const service = createAssetService({sourceTab: 3, expectedURL: 'https://chatgpt.com/c/a', job: 'test'});
  service.begin();
  const message = {type: 'KEEPCHAT_IMAGE', job: 'test', url: 'https://images.openai.com/a'};
  assert.equal(service.handle(message, {tab: {id: 4}, url: 'https://chatgpt.com/c/a'}, () => assert.fail()), false);
  assert.equal(service.handle({...message, job: 'other'}, {tab: {id: 3}, url: 'https://chatgpt.com/c/a'}, () => assert.fail()), false);
  assert.equal(service.handle(message, {tab: {id: 3}, url: 'https://chatgpt.com/c/b'}, () => assert.fail()), false);
  service.abort();
  assert.equal(service.handle(message, {tab: {id: 3}, url: 'https://chatgpt.com/c/a'}, () => assert.fail()), false);
});
test('switching tabs stops screenshots before reading any pixels', async () => {
  const url = 'https://chatgpt.com/c/a';
  let queries = 0, captures = 0;
  globalThis.chrome = {tabs: {
    get: async () => ({windowId: 1, url}),
    query: async () => [{id: ++queries === 1 ? 4 : 5}],
    update: async () => {},
    captureVisibleTab: async () => { captures++; throw new Error('must not capture'); }
  }};
  try {
    const service = createAssetService({sourceTab: 3, expectedURL: url, job: 'test'}); service.begin();
    const result = await new Promise(resolve => service.handle({type: 'KEEPCHAT_SCREENSHOT', job: 'test', token: '1'}, {tab: {id: 3}, url}, resolve));
    assert.equal(result.ok, false); assert.match(result.error, /切换了标签页/); assert.equal(captures, 0);
    await service.finish();
  } finally { delete globalThis.chrome; }
});
test('capture activates the source once and restores the preview without overriding a user tab switch', async () => {
  const url = 'https://chatgpt.com/c/a', updates = [];
  let active = 4, sourceURL = url;
  globalThis.chrome = {tabs: {
    get: async () => ({windowId: 1, url: sourceURL}),
    query: async () => [{id: active}],
    update: async id => { active = id; updates.push(id); }
  }};
  try {
    const service = createAssetService({sourceTab: 3, expectedURL: url, job: 'foreground'});
    service.begin(); await service.activateSource(); await service.activateSource();
    assert.equal(active, 3); assert.deepEqual(updates, [3]);
    await service.finish(); assert.equal(active, 4);
    service.begin(); await service.activateSource(); active = 5;
    await service.finish(); assert.equal(active, 5);
    assert.deepEqual(updates, [3, 4, 3]);
    service.begin(); sourceURL = 'https://chatgpt.com/c/other';
    await assert.rejects(service.activateSource(), /原对话已切换/);
    assert.equal(active, 5); await service.finish();
  } finally { delete globalThis.chrome; }
});
const fixture = {title: '标题 </title><script>alert(1)</script>', url: 'https://chatgpt.com/c/test', exportedAt: '2026-11-12T10:00:00Z', width: 720, background: '#fff', color: '#111', css: '.kept-s1::before{content:"</style><script>bad</script>"}', warnings: ['图片 <img onerror="bad">'], messages: [{role: 'user', html: '<p>原文 &amp; 符号</p>', markdown: '原文\n\n```js\n  a\n\n\n  b\n```'}]};
test('URL boundary rejects misleading hosts and unsafe schemes', () => {
  for (const url of ['https://chatgpt.com/c/a', 'https://chatgpt.com/s/t_a', 'https://chatgpt.com/share/a', 'https://chat.openai.com/c/a']) assert.ok(isChatURL(url));
  for (const url of ['https://chatgpt.com.evil.test/c/a', 'http://chatgpt.com/c/a', 'javascript:alert(1)', 'https://chatgpt.com@evil.test/', 'bad']) assert.equal(isChatURL(url), false);
});
test('filenames cannot traverse paths and handle Windows names and Unicode', () => {
  assert.equal(fileName('../../CON', 'html'), '_CON.html');
  assert.equal(fileName('NUL.md', 'md'), '_NUL.md');
  assert.equal(fileName('   .. ', 'html'), 'ChatGPT 对话.html');
  assert.equal(fileName('关于 AI 的对话.html', 'html'), '关于 AI 的对话.html');
  assert.ok(!fileName('a\u0000/b\\c:d', 'html').includes('\u0000'));
});
test('HTML metadata and CSS cannot break out into markup', () => {
  const html = buildHTML(fixture);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror='));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('原文 &amp; 符号'));
  assert.ok(html.includes('https://chatgpt.com/c/test'));
  assert.ok(!buildHTML(fixture, {includeSource: false}).includes('https://chatgpt.com/c/test'));
  assert.equal(escapeHTML('"<>&'), '&quot;&lt;&gt;&amp;');
});
test('Markdown preserves code whitespace and source preference', () => {
  assert.ok(buildMarkdown(fixture).includes('  a\n\n\n  b'));
  assert.ok(!buildMarkdown(fixture, {includeSource: false}).includes(fixture.url));
});
