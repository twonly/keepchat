import {buildHTML, buildMarkdown, fileName, formatBytes, isChatURL} from './archive.js';
import {previewStore} from './store.js';
import {createAssetService} from './assets.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const id = params.get('id') || crypto.randomUUID();
const sourceTab = Number(params.get('tab'));
const expectedURL = params.get('source');
const assets = createAssetService({sourceTab, expectedURL, job: id});
let current = null, busy = false, html = '', frameReady = Promise.resolve();
const downloads = new Map();
function status(message, error = false) {
  $('statusText').textContent = message;
  $('statusBar').classList.toggle('error', error);
}
function setBusy(value) {
  busy = value;
  for (const name of ['downloadHTML', 'downloadMarkdown', 'printPDF', 'clear']) $(name).disabled = value || !current;
  $('retry').disabled = value || !isChatURL(expectedURL);
  $('scanAll').disabled = value;
  $('cancel').hidden = !value;
  $('filename').disabled = value;
  $('includeSource').disabled = value;
}
function render() {
  if (!current) return;
  html = buildHTML(current, {includeSource: $('includeSource').checked});
  $('title').textContent = current.title;
  document.title = current.title + ' · 留存';
  $('messageCount').textContent = current.messages.length;
  $('imageCount').textContent = `${current.images.saved}/${current.images.total}`;
  $('fileSize').textContent = formatBytes(new Blob([html]).size);
  $('sourceLink').href = current.url;
  $('sourceLink').hidden = false;
  $('emptyState').hidden = true;
  $('preview').hidden = false;
  frameReady = new Promise(resolve => { $('preview').onload = resolve; });
  $('preview').srcdoc = html;
  $('report').hidden = false;
  $('report').classList.toggle('warn', current.warnings.length > 0);
  $('reportTitle').textContent = current.warnings.length ? '已生成快照，有内容需要检查' : '对话快照已准备好';
  $('reportSummary').textContent = `${current.scanned ? '已扫描页面首尾' : '保存已加载内容'}${current.images.screenshots ? ` · ${current.images.screenshots} 张截图` : ''} · ${new Date(current.exportedAt).toLocaleTimeString('zh-CN')} 读取`;
  $('rangeLabel').textContent = `${current.messages.length} 条消息 · 当前分支 · ${current.scanned ? '已扫描页面' : '已加载内容'}`;
  $('warningDetails').hidden = !current.warnings.length;
  $('warningSummary').textContent = `查看 ${current.warnings.length} 项保存说明`;
  $('warningList').replaceChildren(...current.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
async function capture() {
  if (busy) return;
  if (!Number.isInteger(sourceTab) || sourceTab <= 0 || !isChatURL(expectedURL)) {
    showEmpty('从一段对话开始', '在 ChatGPT 打开需要保存的对话，点击浏览器工具栏的留存图标，再选择“打开导出预览”。');
    status('当前没有连接到对话，请从扩展图标打开工作台。');
    setBusy(false); return;
  }
  setBusy(true);
  assets.begin();
  status('正在连接原对话标签页…');
  try {
    await chrome.scripting.executeScript({target: {tabId: sourceTab}, files: ['src/content.js']});
    const [response] = await chrome.scripting.executeScript({target: {tabId: sourceTab}, func: async options => {
      try { return {ok: true, conversation: await globalThis.keepChat.capture(options)}; }
      catch (error) { return {ok: false, error: error.message}; }
    }, args: [{job: id, expectedURL, scan: $('scanAll').checked}]});
    if (!response?.result?.ok) throw new Error(response?.result?.error || '未收到读取结果，请检查原标签页后重试。');
    current = response.result.conversation;
    $('filename').value = fileName(current.title, 'html').replace(/\.html$/, '');
    try { await previewStore('put', id, current); }
    catch (error) { current.warnings.push(error.message); }
    render();
    status(current.warnings.length ? '预览已就绪。请检查保存说明，然后下载文件。' : '预览已就绪，可以保存这段对话了。');
  } catch (error) {
    const message = /No tab|Cannot access|Missing host permission|Frame with ID|The tab was closed/i.test(error.message) ? '原对话标签页已关闭或访问权限已失效。请回到对话，再点击留存图标。' : error.message;
    status((current ? '读取失败；当前仍是上一次快照。' : '') + message, true);
    if (!current) showEmpty('这次没能读到对话', message);
  } finally { await assets.finish(); setBusy(false); }
}
function showEmpty(title, detail) {
  $('emptyState').hidden = false; $('preview').hidden = true;
  $('emptyTitle').textContent = title; $('emptyText').textContent = detail;
}
async function download(format) {
  if (!current || busy) return;
  const name = fileName($('filename').value || current.title, format);
  const body = format === 'html' ? html : buildMarkdown(current, {includeSource: $('includeSource').checked});
  const url = URL.createObjectURL(new Blob([body], {type: format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8'}));
  try {
    const downloadID = await chrome.downloads.download({url, filename: name, saveAs: true, conflictAction: 'uniquify'});
    downloads.set(downloadID, {url, name});
    status(`已交给 Chrome 保存：${name}`);
    const [item] = await chrome.downloads.search({id: downloadID});
    if (item?.state === 'complete' || item?.state === 'interrupted') finishDownload(downloadID, item.state, item.error);
  } catch (error) { URL.revokeObjectURL(url); status(/cancel/i.test(error.message) ? '已取消保存，可以随时重新下载。' : `下载失败：${error.message}`, true); }
}
function finishDownload(downloadID, state, error) {
  const item = downloads.get(downloadID);
  if (!item) return;
  URL.revokeObjectURL(item.url); downloads.delete(downloadID);
  status(state === 'complete' ? `已保存：${item.name}。可以将这个文件发送给他人。` : `保存未完成：${error || '下载中断'}。请重新下载。`, state !== 'complete');
}
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') finishDownload(delta.id, delta.state.current, delta.error?.current);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (busy && message.type === 'KEEPCHAT_PROGRESS' && message.job === id && sender.tab?.id === sourceTab) status(message.detail);
  return assets.handle(message, sender, sendResponse);
});
$('cancel').addEventListener('click', async () => {
  assets.abort();
  $('cancel').disabled = true;
  status('正在取消，稍后恢复原页面滚动位置…');
  try { await chrome.scripting.executeScript({target: {tabId: sourceTab}, func: job => globalThis.keepChat?.cancel(job), args: [id]}); }
  catch (error) { status(error.message, true); }
  finally { $('cancel').disabled = false; }
});
window.addEventListener('pagehide', () => {
  assets.abort();
  if (busy) chrome.scripting.executeScript({target: {tabId: sourceTab}, func: job => globalThis.keepChat?.cancel(job), args: [id]}).catch(() => {});
});
$('retry').addEventListener('click', capture);
$('downloadHTML').addEventListener('click', () => download('html'));
$('downloadMarkdown').addEventListener('click', () => download('md'));
$('includeSource').addEventListener('change', render);
$('desktopView').addEventListener('click', () => setView(false));
$('mobileView').addEventListener('click', () => setView(true));
function setView(mobile) {
  $('previewSurface').classList.toggle('mobile', mobile);
  $('desktopView').setAttribute('aria-pressed', String(!mobile));
  $('mobileView').setAttribute('aria-pressed', String(mobile));
}
$('printPDF').addEventListener('click', async () => {
  try {
    await frameReady;
    await $('preview').contentDocument.fonts.ready;
    await Promise.all([...$('preview').contentDocument.images].map(img => img.decode().catch(() => {})));
    $('preview').contentWindow.focus(); $('preview').contentWindow.print();
    status('在打印窗口选择“另存为 PDF”；想保留底色，请勾选“背景图形”。');
  } catch (error) { status(`无法打开打印窗口：${error.message}`, true); }
});
$('clear').addEventListener('click', async () => {
  try {
    await previewStore('delete', id);
    current = null; html = ''; $('preview').srcdoc = ''; $('report').hidden = true;
    $('messageCount').textContent = '—'; $('imageCount').textContent = '—'; $('fileSize').textContent = '—';
    $('title').textContent = '本地预览已清除'; $('filename').value = '';
    showEmpty('已清除这份预览', '已下载的文件仍在原位置。需要时可以重新读取对话。');
    status('本地预览已清除。'); setBusy(false);
  } catch (error) { status(error.message, true); }
});
async function initialize() {
  setBusy(true);
  try {
    current = await previewStore('get', id);
    if (current) {
      $('filename').value = fileName(current.title, 'html').replace(/\.html$/, '');
      render(); status('已恢复本机缓存的快照。原对话有更新时，请重新读取。');
      setBusy(false); return;
    }
  } catch (error) { status(error.message, true); }
  setBusy(false); await capture();
}
initialize();
