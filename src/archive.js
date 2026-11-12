export const roleLabel = role => ({user: '你', assistant: 'ChatGPT', system: '系统', tool: '工具'}[role] || '消息');
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const isChatURL = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(url.hostname); }
  catch { return false; }
};
export function fileName(value, extension) {
  let name = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').replace(/\.(html|md|pdf)$/i, '').slice(0, 100).trim();
  if (!name) name = 'ChatGPT 对话';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return `${name}.${extension}`;
}
export function buildHTML(conversation, {includeSource = true} = {}) {
  const c = conversation, title = escapeHTML(c.title);
  const source = includeSource && isChatURL(c.url) ? `<a href="${escapeHTML(c.url)}" target="_blank" rel="noopener noreferrer">查看原对话 ↗</a>` : '';
  const notices = c.warnings.length ? `<details class="archive-notes"><summary>保存说明 · ${c.warnings.length} 项</summary><ul>${c.warnings.map(w => `<li>${escapeHTML(w)}</li>`).join('')}</ul></details>` : '';
  const css = String(c.css || '').replace(/</g, '\\3c ');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="referrer" content="no-referrer"><meta name="generator" content="KeepChat 1.0"><title>${title}</title>
<style>
${css}
html{background:${escapeHTML(c.background)};color:${escapeHTML(c.color)};color-scheme:normal}body{margin:0}*{box-sizing:border-box} .archive{width:100%;max-width:${(Number(c.width) || 800) + 48}px;margin:0 auto;padding:32px 24px 56px}.archive-header{font:13px/1.7 'PingFang SC','Microsoft YaHei',sans-serif;border-bottom:1px solid #8884;margin:0 0 24px;padding:0 0 22px}.archive-header h1{font-size:24px;line-height:1.4;margin:10px 0;overflow-wrap:anywhere}.archive-meta{display:flex;gap:16px;flex-wrap:wrap;opacity:.65}.archive-header a{color:inherit}.archive-label{font-size:10px;letter-spacing:2px;opacity:.55}.archive-notes{font:12px/1.8 'PingFang SC',sans-serif;margin-top:16px;opacity:.8}.archive-notes summary{cursor:pointer}.kept-turn{width:100%!important;height:auto!important;min-width:0!important;max-height:none!important;min-height:0!important;margin:0 0 24px!important;contain:none!important;content-visibility:visible!important}.kept-turn img{max-width:100%!important;height:auto!important}.kept-turn pre{max-height:none!important;overflow:auto!important}.kept-turn table{max-width:100%}
/* ChatGPT's desktop table gutters are measured against the original viewport. */
.kept-turn div:has(> div > table:only-child){margin-left:0!important;margin-right:0!important;width:100%!important;max-width:100%!important}
.kept-turn div:has(> table:only-child){padding-left:0!important;padding-right:0!important;width:100%!important;max-width:100%!important}
.kept-missing{display:block;padding:16px;border:1px dashed #a88b57;border-radius:8px;font:13px/1.7 sans-serif;color:#9b682d}.archive-footer{font:11px/1.8 'PingFang SC',sans-serif;opacity:.55;border-top:1px solid #8884;padding-top:20px;margin-top:32px} @media(max-width:600px){.archive{padding:24px 16px}.kept-turn{padding-left:0!important;padding-right:0!important}:where(.kept-turn *){max-width:100%}.kept-turn :is(div,section,article,p,pre,table){min-width:0!important}.kept-turn table{display:block;overflow-x:auto;width:100%!important;max-width:100%!important}.kept-turn :is(th,td){min-width:8em!important;overflow-wrap:normal!important;word-break:normal!important}.kept-turn th{white-space:nowrap!important}.archive-header h1{font-size:21px}}@page{margin:14mm}@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.archive{max-width:none;padding:0}.kept-turn pre{white-space:pre-wrap!important;overflow:visible!important}.kept-turn pre code{white-space:pre-wrap!important}.kept-turn table{break-inside:auto}.kept-turn tr,.kept-turn img{break-inside:avoid}.kept-turn h1,.kept-turn h2,.kept-turn h3{break-after:avoid}.archive-notes{display:block}.archive-header a{display:none}}
</style></head><body><main class="archive"><header class="archive-header"><span class="archive-label">KEEPCHAT / 对话留存</span><h1>${title}</h1><div class="archive-meta"><span>${c.messages.length} 条消息</span><span>${escapeHTML(new Date(c.exportedAt).toLocaleString('zh-CN'))}</span>${source}</div>${notices}</header>
${c.messages.map((m, i) => `<section id="message-${i + 1}" aria-label="${i + 1}. ${escapeHTML(roleLabel(m.role))}">${m.html}</section>`).join('\n')}
<footer class="archive-footer">保存的是当前对话分支的页面快照。未加载的内容、其他分支及附件原文件不在快照中。<br>此文件可离线阅读；对话中的外部链接需要联网，部分链接可能失效。</footer></main></body></html>`;
}
export function buildMarkdown(c, {includeSource = true} = {}) {
  const lines = [`# ${c.title.replace(/[\r\n]/g, ' ')}`, '', `保存时间：${c.exportedAt}`, `消息数：${c.messages.length}`];
  if (includeSource) lines.push(`来源：${c.url}`);
  if (c.warnings.length) lines.push('', ...c.warnings.map(w => `> ${w}`));
  for (const [i, message] of c.messages.entries()) lines.push('', '---', '', `## ${i + 1}. ${roleLabel(message.role)}`, '', message.markdown.trim());
  return lines.join('\n') + '\n';
}
export function formatBytes(size) { return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
