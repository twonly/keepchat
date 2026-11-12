import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Only fictional, locally routed content enters the public screenshots.
const root = process.cwd();
const fixture = await readFile('docs/demo.html', 'utf8');
const graphic = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="#edf0e6"/><rect x="40" y="40" width="340" height="220" rx="16" fill="#fffef9"/><rect x="430" y="40" width="340" height="220" rx="16" fill="#fffef9"/><rect x="820" y="40" width="340" height="220" rx="16" fill="#203b31"/><g font-family="Georgia" font-size="20" fill="#b76747"><text x="76" y="100">01 / CONVERSATION</text><text x="466" y="100">02 / PRESERVE</text><text x="856" y="100" fill="#b9c9ac">03 / SHARE</text></g><g font-size="52" fill="#203b31"><text x="76" y="194">对话</text><text x="466" y="194">留存</text><text x="856" y="194" fill="#fffef9">分享</text></g></svg>';
const profile = await mkdtemp(path.join(tmpdir(), 'keepchat-screenshots-'));
const context = await chromium.launchPersistentContext(profile, {channel: 'chromium', headless: true, reducedMotion: 'reduce', viewport: {width: 1280, height: 800}, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions']});
await mkdir('docs/screenshots', {recursive: true});
try {
  await context.route('https://chatgpt.com/**', route => route.fulfill(new URL(route.request().url()).pathname === '/demo-image.svg'
    ? {contentType: 'image/svg+xml', body: graphic}
    : {contentType: 'text/html; charset=utf-8', body: fixture}));
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: root});
  const source = await context.newPage();
  await source.goto('https://chatgpt.com/c/keepchat-demo');
  const {targetInfos} = await cdp.send('Target.getTargets', {filter: [{type: 'tab', exclude: false}, {exclude: true}]});
  const target = targetInfos.find(t => t.url === source.url());
  assert.ok(target);
  await cdp.send('Extensions.triggerAction', {id, targetId: target.targetId});
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await source.bringToFront();
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#openPreview').disabled);
  const next = context.waitForEvent('page', {predicate: page => page !== popup});
  await popup.locator('#openPreview').click();
  const workbench = await next;
  await workbench.waitForURL(/export\.html/);
  await workbench.waitForFunction(() => !document.querySelector('#downloadHTML').disabled, null, {timeout: 120000});
  assert.equal(await workbench.locator('#messageCount').innerText(), '6');
  assert.equal(await workbench.locator('#imageCount').innerText(), '1/1');
  await workbench.locator('#includeSource').uncheck();
  await workbench.waitForFunction(() => {
    const doc = document.querySelector('#preview').contentDocument;
    return doc?.readyState === 'complete' && doc.querySelector('table') && !doc.body.textContent.includes('查看原对话');
  });
  await workbench.screenshot({path: 'docs/screenshots/workbench.png'});
  await workbench.locator('#mobileView').click();
  const frame = workbench.frameLocator('#preview');
  await frame.locator('table').evaluate(table => table.scrollIntoView({block: 'center'}));
  assert.ok(await frame.locator('table').evaluate(el => el.scrollWidth >= el.clientWidth));
  await workbench.screenshot({path: 'docs/screenshots/mobile-preview.png'});
  const promo = await context.newPage();
  await promo.setViewportSize({width: 440, height: 280});
  const icon = (await readFile('icons/128.png')).toString('base64');
  await promo.setContent(`<html lang="zh-CN"><body style="margin:0;background:#f8f8f3;color:#203b31;font-family:'PingFang SC',sans-serif;padding:28px;box-sizing:border-box"><div style="display:flex;align-items:center;gap:12px"><img width="48" height="48" src="data:image/png;base64,${icon}"><div><b style="font-size:24px;letter-spacing:4px">留存</b><div style="font:10px Georgia;letter-spacing:3px;margin-top:3px">KEEPCHAT</div></div></div><h1 style="font-size:29px;line-height:1.45;margin:23px 0 12px">把好对话，<br>变成可以分享的记录。</h1><div style="font-size:12px;color:#7b8476">ChatGPT 对话导出 · HTML / PDF / Markdown</div></body></html>`);
  await promo.locator('img').evaluate(img => img.decode());
  await promo.screenshot({path: 'docs/screenshots/promo-440x280.png'});
  console.log('PASS: actual extension, 6 fictional messages, 1/1 embedded images, desktop/mobile screenshots and promo tile');
} finally {
  await context.close();
  await rm(profile, {recursive: true, force: true});
}
