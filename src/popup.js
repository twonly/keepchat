import {isChatURL} from './archive.js';
const $ = id => document.getElementById(id);
let sourceTab, conversation;
$('version').textContent = chrome.runtime.getManifest().version;
async function readCurrent() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!isChatURL(tab?.url)) throw new Error('先在 ChatGPT 打开一段对话，再点击留存图标。');
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['src/content.js']});
  const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => globalThis.keepChat.inspect({waitMs: 5000})});
  if (!result?.result) throw new Error('未收到页面读取结果，请刷新网页后重新识别。');
  if (result.result.url !== tab.url) throw new Error('识别期间切换了对话，请重新识别。');
  return {tab, conversation: result.result};
}
async function refresh() {
  sourceTab = null; conversation = null;
  document.querySelector('.popup').setAttribute('aria-busy', 'true');
  $('openPreview').disabled = true;
  $('buttonText').textContent = '正在识别…';
  $('refresh').disabled = true;
  $('status').className = 'status';
  $('connectionBadge').textContent = '正在识别当前页面';
  $('conversationTitle').textContent = '正在读取…';
  $('messageCount').textContent = '请稍候';
  $('openChat').hidden = true;
  let timeout;
  try {
    const result = await Promise.race([readCurrent(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('连接页面超时，请刷新 ChatGPT 网页后重新打开插件。')), 12000); })]);
    sourceTab = result.tab; conversation = result.conversation;
    $('conversationTitle').textContent = conversation.title;
    $('messageCount').textContent = `当前页面：${conversation.count} 条消息 · ${conversation.images} 张图片`;
    if (!conversation.count) throw new Error('未识别到对话正文。如果正文已经显示，请刷新网页后重新识别；也可以打开这段对话的分享页导出。');
    if (conversation.streaming) throw new Error('ChatGPT 还在生成回复，结束后点击右上角重新识别。');
    $('connectionBadge').textContent = '已找到对话 · 尚未完整扫描';
    $('status').textContent = conversation.inferred ? '已通过正文结构识别，当前数量不是对话总数。读取时会切回原页，请保持原页在前台。' : '当前数量不是对话总数。读取时会切回原页完整扫描，完成后返回预览；请勿切换标签页。';
    $('buttonText').textContent = '打开导出预览';
    $('openPreview').disabled = false;
  } catch (error) {
    $('openChat').hidden = !error.message.startsWith('先在 ChatGPT');
    $('connectionBadge').textContent = '暂时无法读取';
    $('conversationTitle').textContent = conversation?.title || '未能读取对话';
    $('messageCount').textContent = '请查看下方原因，处理后点击右上角重试';
    $('buttonText').textContent = '暂时无法导出';
    $('status').textContent = error.message;
    $('status').className = 'status error';
  } finally { clearTimeout(timeout); document.querySelector('.popup').setAttribute('aria-busy', 'false'); $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
$('openPreview').addEventListener('click', async () => {
  $('openPreview').disabled = true;
  $('buttonText').textContent = '正在打开预览…';
  try {
    const params = new URLSearchParams({tab: sourceTab.id, source: conversation.url, id: crypto.randomUUID()});
    await chrome.tabs.create({url: chrome.runtime.getURL('src/export.html') + '?' + params});
    window.close();
  } catch (error) { $('status').textContent = error.message; $('buttonText').textContent = '打开导出预览'; $('openPreview').disabled = false; }
});
refresh();
