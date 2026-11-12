import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'keepchat-detection-'));
const context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions']});
const turns = '<li data-message-role="user" id="u1"><p>用户的问题</p></li><li data-message-role="assistant" id="a1"><div data-assistant-markdown><p>完整的回答</p><table><tr><td>表格内容</td></tr></table></div></li>';
const fixtures = {
  shell: await readFile('tests/fixtures/app-shell.html', 'utf8'),
  multiple: `<main hidden><article data-testid="conversation-turn-hidden" data-turn="assistant">HIDDEN_PRIVATE</article></main><nav><div data-message-role="user">SIDEBAR_PRIVATE</div></nav><div role="main"><ol data-conversation-transcript>${turns}</ol></div>`,
  markers: '<main><article id="q"><div class="user-message-bubble">用户的问题</div></article><article id="a"><div data-assistant-markdown><p>完整的回答</p></div></article></main>',
  transcript: `<main><ol data-conversation-transcript>${turns.replaceAll(/ data-message-role="[^"]+"/g, '')}</ol></main>`,
  divs: '<main><div data-testid="conversation-turn-0"><h5>你说：</h5><p>用户的问题</p></div><div data-testid="conversation-turn-1"><h6>ChatGPT 说：</h6><p>完整的回答</p></div></main>',
  delayed: `<main><ol data-conversation-transcript id="turns"></ol></main><script>setTimeout(()=>document.querySelector('#turns').innerHTML=${JSON.stringify(turns)}, 1600)</script>`,
  empty: '<main><h1>还未加载正文</h1></main>'
};
try {
  await context.route('https://chatgpt.com/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>普通对话 - ChatGPT</title>' + fixtures[new URL(route.request().url()).pathname.split('/').pop()]}));
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: process.cwd()});
  const source = await context.newPage();
  await source.goto('https://chatgpt.com/c/multiple');
  const {targetInfos} = await cdp.send('Target.getTargets', {filter: [{type: 'tab', exclude: false}, {exclude: true}]});
  await cdp.send('Extensions.triggerAction', {id, targetId: targetInfos.find(t => t.url === source.url()).targetId});
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await source.bringToFront();
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await popup.locator('#openPreview').isDisabled(), false, await popup.locator('#status').innerText());
  assert.match(await popup.locator('#messageCount').innerText(), /2 条消息/);
  assert.equal(await popup.locator('#version').innerText(), await popup.evaluate(() => chrome.runtime.getManifest().version));
  const sourceID = await popup.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  for (const name of ['markers', 'transcript', 'divs', 'delayed', 'shell']) {
    await source.goto(`https://chatgpt.com/c/${name}`);
    const result = await popup.evaluate(async tab => {
      await chrome.scripting.executeScript({target: {tabId: tab}, files: ['src/content.js']});
      return (await chrome.scripting.executeScript({target: {tabId: tab}, func: () => globalThis.keepChat.inspect({waitMs: 5000})}))[0].result;
    }, sourceID);
    assert.equal(result.count, name === 'shell' ? 6 : 2, name);
    if (name === 'shell') {
      const firstQuestion = await source.locator('[data-chatgpt-search-message-ids="user-1"]').textContent();
      const captured = await popup.evaluate(async tab => (await chrome.scripting.executeScript({target: {tabId: tab}, func: () => globalThis.keepChat.capture({job: 'shell', expectedURL: location.href})}))[0].result, sourceID);
      assert.equal(captured.scanned, true);
      assert.deepEqual(captured.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
      assert.deepEqual(captured.messages.map(m => m.id), ['user-1', 'assistant-1', 'user-2', 'assistant-2', 'user-3', 'assistant-3']);
      assert.deepEqual(captured.messages.map(m => m.text.trim()), [firstQuestion.trim(), '思考了 4m 7s\n            \n            完整的回答表格内容const value = 1;\n  console.log(value);', '第二轮问题', '思考了 12s第二轮回答缩略图卡片标题', '生成封面', '已创建图像']);
      assert.deepEqual(captured.images, {total: 1, saved: 1, screenshots: 0});
      assert.ok(captured.messages[5].html.includes('data:image/svg+xml;base64,'), 'Image-only button and reply are preserved');
      assert.ok(Number(await source.locator('body').getAttribute('data-remounts')) >= 2, 'Message nodes were remounted during scanning');
    }
    if (name === 'markers' || name === 'divs') {
      const roles = await popup.evaluate(async tab => (await chrome.scripting.executeScript({target: {tabId: tab}, func: async () => (await globalThis.keepChat.capture({job: 'roles', expectedURL: location.href, scan: false})).messages.map(m => m.role)}))[0].result, sourceID);
      assert.deepEqual(roles, ['user', 'assistant'], name);
    }
  }
  await source.goto('https://chatgpt.com/c/empty');
  await source.bringToFront();
  await popup.locator('#refresh').click();
  assert.equal(await popup.locator('.popup').getAttribute('aria-busy'), 'true');
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled, null, {timeout: 12000});
  assert.equal(await popup.locator('#openPreview').isDisabled(), true);
  assert.equal(await popup.locator('.popup').getAttribute('aria-busy'), 'false');
  assert.equal(await popup.locator('#openPreview').evaluate(el => getComputedStyle(el).cursor), 'not-allowed');
  assert.match(await popup.locator('#status').innerText(), /未识别到对话正文/);
  await popup.evaluate(() => { globalThis.originalExecute = chrome.scripting.executeScript; chrome.scripting.executeScript = () => new Promise(() => {}); });
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled, null, {timeout: 15000});
  assert.match(await popup.locator('#status').innerText(), /连接页面超时/);
  assert.equal(await popup.locator('#openPreview').isDisabled(), true);
  assert.equal(await popup.locator('.popup').getAttribute('aria-busy'), 'false');
  await popup.evaluate(() => { chrome.scripting.executeScript = globalThis.originalExecute; delete globalThis.originalExecute; });
  await source.goto('https://chatgpt.com/c/shell');
  await source.bringToFront();
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#openPreview').disabled);
  await mkdir('output/playwright/detection', {recursive: true});
  await popup.screenshot({path: 'output/playwright/detection/popup.png', clip: {x: 0, y: 0, width: 380, height: 620}});
  const opened = context.waitForEvent('page');
  await popup.locator('#openPreview').click();
  const workbench = await opened;
  await workbench.waitForFunction(() => document.querySelector('#downloadHTML') && !document.querySelector('#downloadHTML').disabled, null, {timeout: 30000});
  assert.equal(await workbench.locator('#messageCount').innerText(), '6');
  const html = await workbench.locator('#preview').getAttribute('srcdoc');
  assert.ok(html.includes('用户的问题') && html.includes('完整的回答') && html.includes('表格内容'));
  assert.ok(html.includes('1. 你') && html.includes('2. ChatGPT'));
  assert.ok(html.includes('3. 你') && html.includes('4. ChatGPT'));
  assert.ok(html.includes('5. 你') && html.includes('6. ChatGPT'));
  assert.equal(await workbench.frameLocator('#preview').locator('img').evaluate(img => img.complete && img.naturalWidth === 20), true);
  for (const mobile of [false, true]) {
    await workbench.locator(mobile ? '#mobileView' : '#desktopView').click();
    assert.ok((await workbench.frameLocator('#preview').getByText('缩略图', {exact:true}).boundingBox()).width <= 76);
    assert.ok((await workbench.frameLocator('#preview').getByText('卡片标题', {exact:true}).boundingBox()).width > 40);
    assert.equal(await workbench.frameLocator('#preview').locator('#message-1 p').last().evaluate(p => {
      const rect = p.getBoundingClientRect();
      for (let n = p.parentElement; n; n = n.parentElement) {
        if (getComputedStyle(n).overflowX !== 'hidden') continue;
        const box = n.getBoundingClientRect();
        if (rect.left < box.left - 1 || rect.right > box.right + 1) return false;
      }
      return true;
    }), true, `Long question stays inside its bubble (${mobile ? 'mobile' : 'desktop'})`);
  }
  assert.equal((html.match(/思考了 4m 7s/g) || []).length, 1);
  assert.equal((html.match(/思考了 12s/g) || []).length, 1);
  assert.ok(!html.includes('HIDDEN_PRIVATE') && !html.includes('SIDEBAR_PRIVATE'));
  console.log('PASS ordinary/app-shell conversation detection, remounted message deduplication, roles/thinking summaries, body/transcript fallbacks, delayed loading, finite error state and popup-to-export flow');
} finally { await context.close(); await rm(profile, {recursive: true, force: true}); }
