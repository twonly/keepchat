import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const profile = await mkdtemp(path.join(tmpdir(), 'keepchat-virtualization-'));
const context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, viewport: {width: 1000, height: 800}, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions']});
try {
  const fixture = await readFile('tests/fixtures/virtualized.html', 'utf8');
  await context.route('https://chatgpt.com/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: fixture}));
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: process.cwd()});
  const source = await context.newPage();
  await source.goto('https://chatgpt.com/c/virtualized');
  const {targetInfos} = await cdp.send('Target.getTargets', {filter: [{type: 'tab', exclude: false}, {exclude: true}]});
  await cdp.send('Extensions.triggerAction', {id, targetId: targetInfos.find(t => t.url === source.url()).targetId});
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  const tab = await popup.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  for (const stable of [false, true]) {
    await source.goto(`https://chatgpt.com/c/virtualized${stable ? '?stable' : ''}`);
    let expected;
    for (const start of [0, 2500, 5400]) {
      await source.locator('main').evaluate((el, top) => { el.scrollTop = top; }, start);
      await source.waitForFunction(top => document.querySelector('[data-chatgpt-search-unit-key] p')?.textContent === '继续' && document.querySelector(`article[data-turn-key="round-${Math.floor(top / 1000)}"] p`), start);
      await source.bringToFront();
      await popup.locator('#refresh').click();
      await popup.waitForFunction(() => !document.querySelector('#openPreview').disabled);
      assert.match(await popup.locator('#messageCount').innerText(), /当前页面：2 条消息/);
      assert.match(await popup.locator('#status').innerText(), /不是对话总数/);
      const captured = await popup.evaluate(async tab => (await chrome.scripting.executeScript({target: {tabId: tab}, func: () => globalThis.keepChat.capture({job: 'virtualized', expectedURL: location.href})}))[0].result, tab);
      assert.equal(captured.scanned, true);
      assert.equal(captured.messages.length, 12, 'All six rounds survive virtual slot reuse');
      assert.equal(new Set(captured.messages.map(m => m.id)).size, 12);
      assert.deepEqual(captured.messages.map(m => m.role), Array.from({length: 6}, () => ['user', 'assistant']).flat());
      for (let i = 0; i < 6; i++) {
        assert.equal(captured.messages[i * 2].text.trim(), '继续', 'Repeated questions are distinct messages');
        assert.ok(captured.messages[i * 2 + 1].text.includes(`第 ${i + 1} 轮完整回答`));
        assert.ok(captured.messages[i * 2 + 1].text.includes(`思考了 ${i + 1}s`));
        assert.ok(captured.messages[i * 2 + 1].html.includes('<table'));
      }
      assert.deepEqual(captured.images, {total: 12, saved: 12, screenshots: 0});
      assert.ok(!captured.messages.some(m => m.text.includes('SIDEBAR_PRIVATE')));
      assert.equal(await source.locator('main').evaluate(el => el.scrollTop), start);
      const summary = captured.messages.map(({id, role, text}) => ({id, role, text}));
      if (expected) assert.deepEqual(summary, expected, 'Start position must not change message IDs, order or text');
      expected = summary;
    }
  }
  await source.bringToFront();
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#openPreview').disabled);
  const opened = context.waitForEvent('page');
  await popup.locator('#openPreview').click();
  const preview = await opened;
  await preview.waitForFunction(async () => {
    const tab = await chrome.tabs.get(Number(new URLSearchParams(location.search).get('tab')));
    return tab.active && document.querySelector('#downloadHTML')?.disabled;
  }, null, {timeout: 5000});
  await preview.waitForFunction(() => document.querySelector('#downloadHTML') && !document.querySelector('#downloadHTML').disabled, null, {timeout: 30000});
  assert.equal(await preview.locator('#messageCount').innerText(), '12');
  assert.equal(await preview.locator('#imageCount').innerText(), '12/12');
  assert.equal(await preview.frameLocator('#preview').locator('.kept-turn').count(), 12);
  assert.equal(await preview.evaluate(async () => (await chrome.tabs.getCurrent()).active), true, 'Return to the preview after scanning');
  const hiddenError = await preview.evaluate(async tab => (await chrome.scripting.executeScript({target: {tabId: tab}, func: async () => {
    const timer = setTimeout(() => Object.defineProperty(document, 'hidden', {configurable: true, value: true}), 1800);
    try { await globalThis.keepChat.capture({job: 'background-interruption', expectedURL: location.href}); return 'unexpected success'; }
    catch (error) { return error.message; }
    finally { clearTimeout(timer); delete document.hidden; }
  }}))[0].result, tab);
  assert.match(hiddenError, /进入后台/);
  assert.equal(await source.locator('main').evaluate(el => el.scrollTop), 5400, 'Interrupted scans restore the source scroll');
  await mkdir('output/playwright/long-conversation', {recursive: true});
  await preview.screenshot({path: 'output/playwright/long-conversation/workbench.png', fullPage: true});
  console.log('PASS virtualized multi-turn export from top/middle/bottom: recycled slots, stable IDs, repeated prompts, thinking summaries, tables, images and scroll restoration');
} finally { await context.close(); await rm(profile, {recursive: true, force: true}); }
