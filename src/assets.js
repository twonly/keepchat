const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function isAllowedImageURL(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return u.hostname === 'images.openai.com' ||
      (u.hostname === 'www.google.com' && u.pathname === '/s2/favicons') ||
      ((u.hostname === 'gstatic.com' || u.hostname.endsWith('.gstatic.com')) && /^\/favicon/.test(u.pathname));
  } catch { return false; }
}

function dataURL(blob) {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('图片超过 8 MiB 限制');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

export function createAssetService({sourceTab, expectedURL, job}) {
  let controller, queue = Promise.resolve(), lastCapture = 0, windowId, previousTab, sourceActivated = false;
  function begin() { controller = new AbortController(); queue = Promise.resolve(); sourceActivated = false; previousTab = undefined; }
  function abort() { controller?.abort(); }
  async function finish() {
    await queue.catch(() => {});
    abort();
    if (previousTab !== undefined) {
      try {
        const [active] = await chrome.tabs.query({active: true, windowId});
        if (active?.id === sourceTab) await chrome.tabs.update(previousTab, {active: true});
      } catch { /* The user may have closed the previous tab. */ }
    }
  }
  function check() { if (!controller) throw new Error('没有正在进行的导出'); controller.signal.throwIfAborted(); }
  async function activateSource() {
    check();
    if (sourceActivated) return;
    const tab = await chrome.tabs.get(sourceTab);
    if (tab.url !== expectedURL || tab.pendingUrl && tab.pendingUrl !== expectedURL) throw new Error('原对话已切换，请回到目标对话重新导出。');
    windowId = tab.windowId;
    const [active] = await chrome.tabs.query({active: true, windowId});
    check();
    previousTab = active?.id;
    sourceActivated = true;
    await chrome.tabs.update(sourceTab, {active: true});
  }
  async function fetchImage(url) {
    check();
    if (!isAllowedImageURL(url)) throw new Error('这个图片源将使用页面截图');
    const response = await fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])});
    if (!response.ok) throw new Error(`图片服务器返回 HTTP ${response.status}`);
    if (!isAllowedImageURL(response.url)) throw new Error('图片跳转到未允许的来源');
    const type = response.headers.get('content-type') || '';
    if (!/^image\//i.test(type)) throw new Error('服务器没有返回图片');
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_IMAGE_BYTES) throw new Error('图片超过 8 MiB 限制');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    return dataURL(new Blob(chunks, {type}));
  }
  async function checkActive() {
    check();
    const tab = await chrome.tabs.get(sourceTab);
    const [active] = await chrome.tabs.query({active: true, windowId: tab.windowId});
    if (active?.id !== sourceTab || tab.url !== expectedURL || tab.pendingUrl && tab.pendingUrl !== expectedURL) throw new Error('截图时切换了标签页或对话，已停止截图');
  }
  async function screenshot(token) {
    await activateSource();
    let canvas, scaleX, scaleY, width, height, y = 0, tiles = 0;
    do {
      let x = 0, nextY = Infinity;
      do {
        check();
        if (++tiles > 64) throw new Error('图片需要过多截图分段');
        await pause(Math.max(0, 600 - (Date.now() - lastCapture)));
        await checkActive();
        const [prepared] = await chrome.scripting.executeScript({target: {tabId: sourceTab}, func: async (job, token, x, y) => {
          try { return {ok: true, view: await globalThis.keepChat.prepareImage(job, token, x, y)}; }
          catch (error) { return {ok: false, error: error.message}; }
        }, args: [job, token, x, y]});
        if (!prepared.result?.ok) throw new Error(prepared.result?.error || '无法定位图片');
        const v = prepared.result.view;
        if (v.clipX > x + 1 || v.clipY > y + 1 || v.clipX + v.rect.width <= x + 0.5 || v.clipY + v.rect.height <= y + 0.5) throw new Error('图片部分区域被遮挡，无法完整截图');
        await checkActive();
        let frame;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { frame = await chrome.tabs.captureVisibleTab(windowId, {format: 'png'}); lastCapture = Date.now(); break; }
          catch (error) {
            if (!/MAX_CAPTURE|too many|quota/i.test(error.message) || attempt === 2) throw error;
            await pause(700); await checkActive();
          }
        }
        await checkActive();
        const [verified] = await chrome.scripting.executeScript({target: {tabId: sourceTab}, func: (job, token) => globalThis.keepChat.verifyImage(job, token), args: [job, token]});
        if (!verified.result) throw new Error('截图期间图片发生移动，已丢弃该截图');
        const bitmap = await createImageBitmap(await (await fetch(frame)).blob());
        frame = null;
        try {
          const sx = bitmap.width / v.viewport.width, sy = bitmap.height / v.viewport.height;
          if (Math.abs(sx - sy) > 0.02) throw new Error('截图与页面尺寸不一致，请退出浏览器设备模拟后重试');
          if (!canvas) {
            width = v.width; height = v.height; scaleX = sx; scaleY = sy;
            if (width * height * sx * sy > 16000000 || width * sx > 16384 || height * sy > 16384) throw new Error('截图图片尺寸过大');
            canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * sx); canvas.height = Math.ceil(height * sy);
          }
          if (Math.abs(v.width - width) > 1 || Math.abs(v.height - height) > 1 || sx !== scaleX || sy !== scaleY) throw new Error('截图期间缩放或图片尺寸发生变化');
          const r = v.rect;
          canvas.getContext('2d').drawImage(bitmap, r.x * sx, r.y * sy, r.width * sx, r.height * sy, v.clipX * sx, v.clipY * sy, r.width * sx, r.height * sy);
        } finally { bitmap.close(); }
        x = v.clipX + v.rect.width; nextY = Math.min(nextY, v.clipY + v.rect.height);
      } while (x < width - 0.5);
      if (nextY <= y + 0.5) throw new Error('截图无法继续向下读取');
      y = nextY;
    } while (y < height - 0.5);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('截图编码失败');
    return dataURL(blob);
  }
  function handle(message, sender, sendResponse) {
    if (!controller || controller.signal.aborted || sender.tab?.id !== sourceTab || sender.url !== expectedURL || message.job !== job) return false;
    let task;
    if (message.type === 'KEEPCHAT_IMAGE') task = fetchImage(message.url);
    else if (message.type === 'KEEPCHAT_SCREENSHOT') {
      task = queue.then(() => screenshot(message.token)); queue = task.catch(() => {});
    } else return false;
    task.then(data => sendResponse({ok: true, data}), error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  return {begin, abort, finish, handle, activateSource};
}
