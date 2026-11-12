const RETENTION = 24 * 60 * 60 * 1000;
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('keepchat-previews', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('previews', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地预览缓存，请检查浏览器存储设置。'));
  });
}
export async function previewStore(action, id, conversation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('previews', 'readwrite'), store = tx.objectStore('previews');
    let result;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (row) { if (Date.now() - row.value.savedAt > RETENTION) row.delete(); row.continue(); }
      else {
        const request = action === 'put' ? store.put({id, conversation, savedAt: Date.now()}) : action === 'delete' ? store.delete(id) : store.get(id);
        request.onsuccess = () => { result = request.result?.conversation; };
      }
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(new Error('本地缓存写入失败；请直接下载文件，刷新页面可能丢失预览。')); };
    tx.onabort = tx.onerror;
  });
}
