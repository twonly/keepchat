(() => {
  if (globalThis.keepChat?.version === 10) return;
  const turnSelector = '[data-testid^="conversation-turn-"], [data-message-author-role], [data-message-role], [data-turn="user"], [data-turn="assistant"], [data-chatgpt-search-unit-key], [data-chatgpt-search-message-ids]';
  const bodySelector = '[data-assistant-markdown], [data-user-message], .user-message-bubble';
  const blockedTags = new Set('SCRIPT STYLE LINK META BASE NOSCRIPT TEMPLATE FORM INPUT TEXTAREA SELECT OPTION OBJECT EMBED'.split(' '));
  const removedControls = '[data-testid*="copy"], [data-testid*="feedback"], [data-testid*="composer"], [data-testid*="share"], [data-message-attribution], .sr-only';
  const styleProperties = ('display box-sizing position top right bottom left float clear color background-color background-image font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent text-shadow white-space word-break overflow-wrap vertical-align direction writing-mode padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left border-top border-right border-bottom border-left border-radius border-collapse border-spacing box-shadow opacity max-width min-width max-height min-height overflow-x overflow-y flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-column grid-row list-style-type list-style-position transform transform-origin fill stroke stroke-width stroke-linecap stroke-linejoin').split(' ');
  let running = null;
  styleProperties.push('background-size', 'background-repeat', 'background-position', 'mask-image', 'mask-size', 'mask-repeat', 'mask-position', 'object-fit', 'object-position');

  function candidates() {
    const visible = node => node.checkVisibility() && !node.closest('[hidden], [inert], [aria-hidden="true"], nav, aside, [role="navigation"], [role="dialog"], [data-testid*="sidebar"], [data-testid*="composer"]');
    let roots = [...document.querySelectorAll(turnSelector)].filter(visible);
    if (!roots.length) roots = [...document.querySelectorAll('[data-conversation-transcript] > li, [data-conversation-transcript] > [role="listitem"]')].filter(visible);
    if (!roots.length) roots = [...new Set([...document.querySelectorAll(bodySelector)].filter(visible).map(node => node.closest('[data-message-id], [data-turn-id], article, [role="listitem"]') || node))].filter(visible);
    return roots.filter(node => !roots.some(other => other !== node && other.contains(node)));
  }
  function roleOf(node) {
    const role = node.getAttribute('data-message-author-role') || node.getAttribute('data-message-role') || node.getAttribute('data-turn') || node.getAttribute('data-chatgpt-search-unit-key')?.match(/:(user|assistant|system|tool)$/)?.[1] || node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || node.querySelector('[data-message-role]')?.getAttribute('data-message-role') || node.querySelector('[data-conversation-role]')?.getAttribute('data-conversation-role') || node.previousElementSibling?.getAttribute('data-conversation-role');
    if (role) return role;
    if (node.matches('[data-user-message], .user-message-bubble') || node.querySelector('[data-user-message], .user-message-bubble')) return 'user';
    if (node.matches('[data-assistant-markdown]') || node.querySelector('[data-assistant-markdown]')) return 'assistant';
    const label = node.querySelector('h1,h2,h3,h4,h5,h6')?.textContent.trim() || '';
    if (/^(你说|您说|用户|You said|User)\s*[:：]?$/i.test(label)) return 'user';
    if (/^(ChatGPT\s*(说|said)?|Assistant)\s*[:：]?$/i.test(label)) return 'assistant';
    return 'message';
  }
  function titleOf(roots) {
    const title = document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT\s*[-|–]\s*/i, '').trim();
    if (title && !/^(ChatGPT|Shared Content)$/i.test(title)) return title;
    return (roots.find(node => roleOf(node) === 'user')?.textContent || 'ChatGPT 对话').trim().replace(/\s+/g, ' ').slice(0, 70);
  }
  function isStreaming() {
    return Boolean(document.querySelector('[data-testid="stop-button"], [data-testid="stop-generating-button"], [data-is-streaming="true"], .result-streaming, [data-assistant-markdown] [aria-busy="true"]'));
  }
  async function inspect({waitMs = 0} = {}) {
    const deadline = Date.now() + Math.min(7000, Math.max(0, waitMs));
    let roots = candidates();
    while (!roots.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      roots = candidates();
    }
    return {title: titleOf(roots), url: location.href, count: roots.length, inferred: roots.some(node => !node.matches(turnSelector)), streaming: isStreaming(), images: roots.reduce((n, root) => n + root.querySelectorAll('img').length, 0)};
  }
  function safeURL(value) {
    if (!value) return '';
    try { const url = new URL(value, location.href); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }

  async function capture({job, expectedURL, scan = true}) {
    if (running) throw new Error('这段对话正在读取，请等当前任务结束。');
    if (location.href !== expectedURL) throw new Error('原标签页已切换对话，请回到需要导出的对话重新打开插件。');
    if (isStreaming()) throw new Error('ChatGPT 还在生成回复，请等回复结束后重新读取。');
    const roots = candidates();
    if (!roots.length) throw new Error('未识别到对话正文。请刷新原网页后重试，或打开这段对话的分享页再导出。');
    const controller = new AbortController();
    running = {job, controller, expectedURL, images: new Map(), scrolls: new Map()};
    const onEscape = event => { if (event.key === 'Escape') controller.abort(new Error('已取消读取，可以重新开始。')); };
    document.addEventListener('keydown', onEscape, true);
    const start = Date.now();
    const warnings = new Set(), styles = new Map(), fonts = new Set(), records = new Map(), resources = new Map();
    if (roots.some(node => !node.matches(turnSelector))) warnings.add('使用正文结构识别消息，请在预览中核对消息顺序和范围。');
    const jobs = [], ids = new WeakMap(), cssResources = new Map();
    const deadline = setTimeout(() => controller.abort(new Error('读取超时，请等待原页面加载完成后重试。')), 180000);
    let nextID = 0, byteCount = 0, imageCount = 0, interactive = 0, scanned = false;
    const sourceWidth = Math.max(600, Math.min(1000, Math.round(roots[0].getBoundingClientRect().width) || 800));
    const scroller = findScroller(roots[0]);
    const previousScroll = {top: scroller.scrollTop, left: scroller.scrollLeft};
    const previousBehavior = scroller.style.scrollBehavior, previousSnap = scroller.style.scrollSnapType;
    const progress = (phase, detail) => chrome.runtime.sendMessage({type: 'KEEPCHAT_PROGRESS', job, phase, detail}).catch(() => {});
    const check = () => {
      controller.signal.throwIfAborted();
      if (location.href !== expectedURL) throw new Error('读取期间切换了对话，已停止导出。请在目标对话重新开始。');
      if (scan && document.hidden) throw new Error('原对话进入后台，已停止读取。请保持原对话标签页在前台，回到预览后点击“重新读取”。');
      if (isStreaming()) throw new Error('读取期间出现了新回复，请等生成结束后重试。');
    };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

    function acceptImage(data) {
      check();
      if (typeof data !== 'string' || !/^data:image\/[\w.+-]+(?:;[^,]*)?;base64,/i.test(data)) throw new Error('未收到有效图片');
      const bytes = Math.ceil(data.slice(data.indexOf(',') + 1).length * 0.75);
      if (bytes > 8 * 1024 * 1024 || byteCount + bytes > 12 * 1024 * 1024) throw new Error('资源超过保存大小限制');
      byteCount += bytes;
      return data;
    }

    async function resource(url, kind) {
      if (!url) throw new Error('资源地址为空');
      const key = kind + url;
      if (resources.has(key)) return resources.get(key);
      const task = (async () => {
        check();
        const parsed = new URL(url, location.href);
        if (!['https:', 'http:', 'data:', 'blob:'].includes(parsed.protocol)) throw new Error('不支持的资源地址');
        let response;
        try {
          response = await fetch(parsed.href, {credentials: parsed.origin === location.origin ? 'include' : 'omit', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])});
          if (!response.ok) throw new Error(`图片服务器返回 HTTP ${response.status}`);
        } catch (error) {
          check();
          if (kind !== 'image' || parsed.protocol !== 'https:') throw error;
          const result = await chrome.runtime.sendMessage({type: 'KEEPCHAT_IMAGE', job, url: parsed.href});
          if (!result?.ok) throw new Error(result?.error || error.message);
          return acceptImage(result.data);
        }
        const type = response.headers.get('content-type') || '';
        if (kind === 'image' && !/^image\//i.test(type)) throw new Error('返回内容不是图片');
        if (kind === 'font' && !/^(font\/|application\/(font|x-font|octet-stream|vnd.ms-fontobject))/i.test(type)) throw new Error('返回内容不是字体');
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.length;
            byteCount += value.length;
            // shortcut: 12 MiB leaves room for HTML and Markdown in Chrome messages; use chunked transfer for larger archives.
            if (size > 8 * 1024 * 1024 || byteCount > 12 * 1024 * 1024) throw new Error('资源超过保存大小限制');
            chunks.push(value);
          }
        } catch (error) { await reader.cancel(); throw error; }
        return new Promise((resolve, reject) => {
          const file = new FileReader();
          file.onload = () => resolve(file.result);
          file.onerror = () => reject(new Error('资源转换失败'));
          file.readAsDataURL(new Blob(chunks, {type}));
        });
      })();
      resources.set(key, task);
      return task;
    }

    function copyStyle(source, target, pseudo = '') {
      const computed = getComputedStyle(source, pseudo || null), declaration = document.createElement('span').style;
      for (const name of styleProperties) {
        let value = computed.getPropertyValue(name);
        if (!value) continue;
        if (name === 'max-width' && value === 'none') continue;
        if (name === 'max-width') value = `min(100%, ${value})`;
        if (/url\s*\(/i.test(value)) {
          for (const match of value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
            const token = match[0];
            if (!cssResources.has(token)) {
              cssResources.set(token, 'none');
              jobs.push(async () => {
                try { cssResources.set(token, `url("${await resource(match[1], 'image')}")`); }
                catch { check(); warnings.add('部分 CSS 背景图或图标未能内嵌，请在预览中检查图示。'); }
              });
            }
          }
        }
        if (name === 'position' && ['fixed', 'sticky'].includes(value)) value = 'static';
        // Preserve auto/percentage anchors instead of freezing their desktop pixel coordinates.
        if (!pseudo && ['top', 'right', 'bottom', 'left'].includes(name)) value = source.computedStyleMap().get(name).toString();
        if (name === 'grid-template-columns') value = value.replace(/([\d.]+)px/g, (_, width) => `minmax(0, ${width}fr)`);
        declaration.setProperty(name, value);
      }
      if (['inline-block', 'inline-flex'].includes(computed.display) || source.namespaceURI.includes('svg') || source.matches('[data-d-component="favicon"]')) {
        declaration.width = computed.width; declaration.height = computed.height;
      }
      if (!pseudo) {
        const width = source.computedStyleMap().get('width');
        if (width?.unit === 'percent') declaration.width = width.toString();
      }
      if (source.tagName === 'IMG') {
        declaration.width = computed.width;
        const width = parseFloat(computed.width), height = parseFloat(computed.height);
        if (width > 0 && height > 0) declaration.aspectRatio = `${width} / ${height}`;
      }
      if (pseudo) declaration.content = computed.content;
      for (const family of computed.fontFamily.split(',')) fonts.add(family.trim().replace(/["']/g, ''));
      const css = declaration.cssText, key = pseudo + css;
      if (!styles.has(key)) styles.set(key, {className: `kept-s${styles.size}`, css, pseudo});
      target.classList.add(styles.get(key).className);
    }
    function placeholder(text) {
      const node = document.createElement('span'); node.className = 'kept-missing'; node.textContent = text; return node;
    }
    function clone(source) {
      if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.nodeValue);
      if (source.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = source.tagName.toUpperCase();
      if (blockedTags.has(tag) || source.matches(removedControls)) return null;
      if (getComputedStyle(source).display === 'none' && tag !== 'DETAILS') return null;
      if (['IFRAME', 'VIDEO', 'AUDIO'].includes(tag)) {
        warnings.add('视频、音频或嵌入式应用仅保存占位说明，需要回到原对话使用。');
        return placeholder(tag === 'IFRAME' ? '嵌入式内容 · 请在原对话中打开' : '音视频内容 · 请在原对话中播放');
      }
      if (tag === 'CANVAS') {
        try {
          const img = document.createElement('img'); img.src = source.toDataURL('image/png'); img.alt = '图表快照';
          byteCount += Math.ceil(img.src.length * 0.75);
          if (byteCount > 12 * 1024 * 1024) throw new Error('画布过大');
          imageCount++; copyStyle(source, img); return img;
        } catch { warnings.add('有一张画布无法保存，请在原对话中查看。'); return placeholder('画布未能保存'); }
      }
      if (tag === 'BUTTON' && ((!source.textContent.trim() && !source.querySelector('img,canvas')) || /^(复制|拷贝|编辑|分享|重试|重新生成|朗读|Copy|Edit|Share|Retry|Read aloud)(\s|$)/i.test(source.textContent.trim()))) return null;
      if (source.namespaceURI.includes('svg') && !/^(SVG|G|PATH|RECT|CIRCLE|ELLIPSE|LINE|POLYLINE|POLYGON|TEXT|TSPAN|TITLE|DESC|USE)$/.test(tag)) {
        warnings.add('部分复杂 SVG 效果未保存，请在预览中检查图示。'); return null;
      }
      let target;
      if (tag === 'BUTTON') { target = document.createElement('span'); interactive++; }
      else if (source.namespaceURI === 'http://www.w3.org/1999/xhtml' && !/^(A|ABBR|ARTICLE|ASIDE|B|BDI|BDO|BLOCKQUOTE|BR|CAPTION|CITE|CODE|COL|COLGROUP|DD|DEL|DETAILS|DFN|DIV|DL|DT|EM|FIGCAPTION|FIGURE|H[1-6]|HR|I|IMG|KBD|LI|MAIN|MARK|OL|P|PRE|Q|RP|RT|RUBY|S|SAMP|SECTION|SMALL|SPAN|STRONG|SUB|SUMMARY|SUP|TABLE|TBODY|TD|TFOOT|TH|THEAD|TIME|TR|U|UL|VAR|WBR)$/.test(tag)) target = document.createElement('span');
      else target = document.createElementNS(source.namespaceURI, source.localName);
      const safeAttributes = /^(alt|title|dir|lang|colspan|rowspan|start|reversed|value|datetime|open|role|aria-label|aria-hidden|viewBox|preserveAspectRatio|d|points|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|fill|fill-rule|clip-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|transform|xmlns|display|mathvariant|encoding|stretchy|fence|separator|accent|accentunder|columnalign|rowalign|columnspacing|rowspacing|linethickness|displaystyle|scriptlevel)$/;
      for (const attribute of source.attributes) if (safeAttributes.test(attribute.name) && !/url\s*\(/i.test(attribute.value)) target.setAttribute(attribute.name, attribute.value);
      if (source.getAttribute('role') === 'button') { target.removeAttribute('role'); if (tag !== 'BUTTON') interactive++; }
      if (tag === 'A') {
        const href = safeURL(source.getAttribute('href'));
        if (href) { target.setAttribute('href', href); target.setAttribute('target', '_blank'); target.setAttribute('rel', 'noopener noreferrer'); }
        if (source.hasAttribute('download') || /\/(?:backend-api\/files|files\/|attachments\/)|sandbox:/i.test(source.getAttribute('href') || '')) warnings.add('附件只保存页面上的卡片和链接，附件原文件需要单独下载。');
      }
      copyStyle(source, target);
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(source, pseudo).content;
        if (content && !['none', 'normal', '""'].includes(content) && !/url\s*\(/i.test(content)) copyStyle(source, target, pseudo);
      }
      if (tag === 'IMG') {
        imageCount++;
        const url = source.currentSrc || source.src, label = source.alt || `未命名图片 ${imageCount}`;
        const token = String(imageCount), favicon = Boolean(source.closest('[data-d-component="favicon"]')) || /\/s2\/favicons\?/.test(url);
        running.images.set(token, {source, url, top: scroller.scrollTop});
        target.setAttribute('loading', 'eager');
        jobs.push(async () => {
          try { target.setAttribute('src', await resource(url, 'image')); }
          catch {
            check();
            try {
              progress('assets', '正在截图保存图片，请暂时不要切换标签页；按 Esc 可取消…');
              const result = await chrome.runtime.sendMessage({type: 'KEEPCHAT_SCREENSHOT', job, token});
              if (!result?.ok) throw new Error(result?.error || '截图通道不可用');
              target.setAttribute('src', acceptImage(result.data));
              target.setAttribute('data-kept-capture', 'screenshot');
            } catch (error) {
              check();
              if (favicon) {
                const icon = document.createElement('span'); icon.textContent = '◻'; icon.title = '网站图标未能保存'; icon.setAttribute('aria-label', icon.title);
                copyStyle(source, icon); target.replaceWith(icon);
              } else target.replaceWith(placeholder(`图片未能保存：${label}`));
              warnings.add(`${favicon ? '网站图标' : label.slice(0, 80)}未能保存：${error.message}。`);
            }
          }
        });
      }
      if (tag === 'USE') {
        const ref = source.getAttribute('href') || source.getAttribute('xlink:href');
        if (ref?.startsWith('#')) {
          const symbol = document.getElementById(ref.slice(1));
          if (symbol && !symbol.contains(source) && !symbol.querySelector('use')) {
            const group = document.createElementNS(source.namespaceURI, 'g');
            for (const child of symbol.childNodes) { const copy = clone(child); if (copy) group.append(copy); } return group;
          }
        }
        warnings.add('部分 SVG 引用无法展开，请检查图示。'); return null;
      }
      if (tag === 'DETAILS' && !source.open) warnings.add('折叠区域保持原状态；页面未加载的折叠内容需要先展开再读取。');
      for (const child of source.childNodes) { const copy = clone(child); if (copy) target.append(copy); }
      return target;
    }
    function collect() {
      check();
      for (const root of candidates()) {
        const messageIDs = [...new Set((root.getAttribute('data-chatgpt-search-message-ids') || '').trim().split(/\s+/))].join('|');
        const stableID = root.getAttribute('data-message-id') || root.getAttribute('data-turn-id') || messageIDs || root.querySelector('[data-message-id]')?.getAttribute('data-message-id');
        const role = roleOf(root), round = root.closest('[data-turn-key]');
        const localID = root.id || root.getAttribute('data-testid') || root.getAttribute('data-chatgpt-search-unit-key')?.replace(/^fallback-turn-\d+:/, '');
        if (!ids.has(root)) ids.set(root, `node-${nextID++}`);
        // Virtualized turns reuse fallback slot numbers; only the round key identifies their place in the conversation.
        const id = stableID || (round && localID ? `${round.getAttribute('data-turn-key')}:${localID}` : root.id || root.getAttribute('data-testid') || root.getAttribute('data-chatgpt-search-unit-key')) || ids.get(root);
        // The app shell puts the thinking summary beside the first assistant message.
        let thought = role === 'assistant' && round && [...round.querySelectorAll(turnSelector)].find(node => roleOf(node) === 'assistant') === root ? round.querySelector('[data-chatgpt-agent-turn-start]')?.parentElement : null;
        if (thought?.querySelector(turnSelector)) thought = null;
        const signature = root.textContent + (thought?.textContent || '') + [...root.querySelectorAll('img')].map(img => img.currentSrc || img.src).join('|') + root.querySelectorAll('*').length;
        if (records.get(id)?.signature === signature) continue;
        const node = clone(root);
        if (!node) continue;
        const summary = thought && clone(thought);
        if (summary) node.prepend(summary);
        node.classList.add('kept-turn'); records.set(id, {node, role, id, signature, imageCount: node.querySelectorAll('img').length});
      }
      progress('scan', `已收集 ${records.size} 条消息，正在读取长对话…`);
    }
    async function embedFonts() {
      const faces = [], used = family => fonts.has(family.replace(/["']/g, '').trim());
      const readRules = (rules, base) => {
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE && used(rule.style.fontFamily)) faces.push({style: rule.style, base});
          else if (rule.cssRules) readRules(rule.cssRules, base);
        }
      };
      for (const sheet of document.styleSheets) {
        check();
        try { readRules(sheet.cssRules, sheet.href || location.href); }
        catch {
          if (!sheet.href) continue;
          try {
            const response = await fetch(sheet.href, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])});
            if (!response.ok) continue;
            const css = new CSSStyleSheet(); css.replaceSync(await response.text()); readRules(css.cssRules, sheet.href);
          } catch { check(); }
        }
      }
      const result = [], saved = new Set();
      for (const {style, base} of faces) {
        check();
        const match = style.getPropertyValue('src').match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
        if (!match) continue;
        try {
          const url = await resource(new URL(match[1], base).href, 'font');
          const fontSheet = new CSSStyleSheet(); fontSheet.replaceSync('@font-face{}');
          const fontStyle = fontSheet.cssRules[0].style;
          for (const key of ['font-family', 'font-weight', 'font-style', 'font-stretch', 'unicode-range']) fontStyle.setProperty(key, style.getPropertyValue(key));
          result.push(`@font-face{${fontStyle.cssText}src:url("${url}");font-display:swap;}`); saved.add(style.fontFamily.replace(/["']/g, '').trim());
        } catch { check(); warnings.add(`字体 ${style.fontFamily} 未内嵌，其他设备可能使用替代字体。`); }
      }
      for (const font of document.fonts) if (used(font.family) && !saved.has(font.family.replace(/["']/g, '').trim())) warnings.add(`字体 ${font.family} 未内嵌，其他设备可能使用替代字体。`);
      return result.join('\n');
    }
    try {
      scroller.style.scrollBehavior = 'auto'; scroller.style.scrollSnapType = 'none';
      if (scan) {
        progress('scan', '正在定位对话开头…');
        let signature = '', stable = 0;
        for (let i = 0; i < 16 && stable < 3; i++) {
          check(); scroller.scrollTop = 0; await pause(250);
          const next = candidates().map(n => n.getAttribute('data-testid') || n.textContent.slice(0, 80)).join('|');
          stable = signature === next ? stable + 1 : 0; signature = next;
        }
        if (stable < 3) warnings.add('对话顶部仍在变化，最早的消息可能尚未加载。');
        let bottomStable = 0, lastHeight = 0;
        for (let step = 0; step < 240 && Date.now() - start < 90000; step++) {
          collect();
          const height = scroller.scrollHeight, atBottom = scroller.scrollTop + scroller.clientHeight >= height - 4;
          bottomStable = atBottom && height === lastHeight ? bottomStable + 1 : 0;
          if (bottomStable >= 3) { scanned = true; break; }
          lastHeight = height;
          scroller.scrollTop = Math.min(height, scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.8)); await pause(250);
        }
        if (!scanned) warnings.add('长对话扫描达到时间或步数限制，当前文件可能不完整；请在原页面确认消息范围。');
      } else { collect(); warnings.add('本次仅保存已加载到页面的消息，没有扫描长对话。'); }
      progress('assets', `正在内嵌 ${imageCount} 张图片与字体…`);
      let done = 0;
      await Promise.all(Array.from({length: Math.min(4, jobs.length)}, async () => {
        while (jobs.length) { check(); await jobs.shift()(); done++; progress('assets', `已处理 ${done} 项资源，正在准备离线文件…`); }
      }));
      const fontCSS = await embedFonts(); check();
      if (interactive) warnings.add(`${interactive} 个交互控件保留为静态内容，引用弹层、工具和应用需要回到原对话使用。`);
      const messages = [...records.values()].map(({node, role, id}) => ({id, role, html: node.outerHTML, text: node.textContent, markdown: toMarkdown(node)}));
      if (!messages.length) throw new Error('没有找到可保存的消息。');
      const main = document.querySelector('main') || document.body;
      let background = 'rgb(255, 255, 255)';
      for (let element = main; element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; }
      }
      let capturedCSS = [...styles.values()].map(({className, css, pseudo}) => `.${className}${pseudo}{${css}}`).join('\n');
      for (const [token, replacement] of cssResources) capturedCSS = capturedCSS.replaceAll(token, replacement);
      const imageStats = [...records.values()].reduce((count, record) => ({total: count.total + record.imageCount, saved: count.saved + record.node.querySelectorAll('img[src^="data:"]').length}), {total: 0, saved: 0});
      imageStats.screenshots = [...records.values()].reduce((n, record) => n + record.node.querySelectorAll('img[data-kept-capture="screenshot"]').length, 0);
      if (imageStats.screenshots) warnings.add(`${imageStats.screenshots} 张图片通过页面截图保存，清晰度以页面显示效果为准。`);
      const result = {version: 1, title: titleOf(candidates()), url: expectedURL, exportedAt: new Date().toISOString(), messages, css: fontCSS + '\n' + capturedCSS, background, color: getComputedStyle(main).color, warnings: [...warnings], scanned, images: imageStats, width: sourceWidth};
      if (new Blob([JSON.stringify(result)]).size > 48 * 1024 * 1024) throw new Error('这段对话超过单次导出大小限制，请先减少页面上的大图或附件后重试。');
      return result;
    } finally {
      clearTimeout(deadline);
      controller.abort();
      document.removeEventListener('keydown', onEscape, true);
      if (location.href === expectedURL) for (const [node, position] of running.scrolls) node.scrollTo({...position, behavior: 'instant'});
      if (location.href === expectedURL) scroller.scrollTo({top: previousScroll.top, left: previousScroll.left, behavior: 'instant'});
      scroller.style.scrollBehavior = previousBehavior; scroller.style.scrollSnapType = previousSnap; running = null;
    }
  }
  function imageEntry(job, token) {
    if (!running || running.job !== job) throw new Error('图片读取任务已结束');
    running.controller.signal.throwIfAborted();
    if (location.href !== running.expectedURL || isStreaming()) throw new Error('对话发生变化，无法截图');
    const entry = running.images.get(token);
    if (!entry) throw new Error('图片不属于当前对话');
    return entry;
  }
  function imageView(image) {
    if (getComputedStyle(image).visibility !== 'visible' || Number(getComputedStyle(image).opacity) === 0) throw new Error('图片尚未显示');
    const r = image.getBoundingClientRect();
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    for (let parent = image.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left + parent.clientLeft); right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top + parent.clientTop); bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight); }
    }
    const visible = (x, y) => { const hit = document.elementFromPoint(x, y); return hit === image || Boolean(hit?.contains(image)); };
    // Trim fixed headers at the edges; never accept a crop covered by another element.
    const points = (a, b) => [a + Math.min(1, (b - a) / 4), (a + b) / 2, b - Math.min(1, (b - a) / 4)];
    while (top < bottom && !points(left, right).every(x => visible(x, top + Math.min(1, (bottom - top) / 2)))) top += 2;
    while (bottom > top && !points(left, right).every(x => visible(x, bottom - Math.min(1, (bottom - top) / 2)))) bottom -= 2;
    while (left < right && !points(top, bottom).every(y => visible(left + Math.min(1, (right - left) / 2), y))) left += 2;
    while (right > left && !points(top, bottom).every(y => visible(right - Math.min(1, (right - left) / 2), y))) right -= 2;
    if (right <= left || bottom <= top || !points(left, right).every(x => points(top, bottom).every(y => visible(x, y)))) throw new Error('图片被遮挡或尚未显示');
    return {width: r.width, height: r.height, clipX: left - r.left, clipY: top - r.top, rect: {x: left, y: top, width: right - left, height: bottom - top}, viewport: {width: innerWidth, height: innerHeight}};
  }
  async function prepareImage(job, token, x, y) {
    const entry = imageEntry(job, token);
    if (!entry.source.isConnected) {
      const scroller = findScroller(candidates()[0] || document.body);
      scroller.scrollTop = entry.top;
      await new Promise(resolve => setTimeout(resolve, 250));
      entry.source = candidates().flatMap(root => [...root.querySelectorAll('img')]).find(img => (img.currentSrc || img.src) === entry.url);
    }
    const source = entry.source;
    if (!source?.isConnected || (source.currentSrc || source.src) !== entry.url) throw new Error('原页面已不再显示这张图片');
    for (let parent = source.parentElement; parent; parent = parent.parentElement) {
      if (parent === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(parent).overflow)) {
        if (!running.scrolls.has(parent)) running.scrolls.set(parent, {top: parent.scrollTop, left: parent.scrollLeft});
        const r = source.getBoundingClientRect(), box = parent.getBoundingClientRect(), doc = parent === document.scrollingElement;
        parent.scrollBy({left: r.left + x - (doc ? 24 : box.left + parent.clientLeft + 24), top: r.top + y - (doc ? 96 : box.top + parent.clientTop + Math.min(96, parent.clientHeight / 4)), behavior: 'instant'});
      }
    }
    await Promise.race([source.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('原页面图片尚未加载')), 3000))]).catch(() => {
      if (!source.complete || !source.naturalWidth) throw new Error('原页面也未能加载图片，请刷新后重试');
    });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    imageEntry(job, token);
    if (!source.naturalWidth || !source.naturalHeight) throw new Error('原页面也未能加载图片');
    entry.view = imageView(source);
    return entry.view;
  }
  function verifyImage(job, token) {
    try {
      const entry = imageEntry(job, token);
      if (!entry.source.isConnected || (entry.source.currentSrc || entry.source.src) !== entry.url) return false;
      const now = imageView(entry.source), before = entry.view;
      return ['width', 'height', 'clipX', 'clipY'].every(key => Math.abs(now[key] - before[key]) < 0.5) &&
        ['x', 'y', 'width', 'height'].every(key => Math.abs(now.rect[key] - before.rect[key]) < 0.5) && now.viewport.width === before.viewport.width && now.viewport.height === before.viewport.height;
    } catch { return false; }
  }
  function findScroller(root) {
    for (let parent = root.parentElement; parent; parent = parent.parentElement) if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 4) return parent;
    return document.scrollingElement;
  }
  function toMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const children = () => [...node.childNodes].map(toMarkdown).join(''), tag = node.localName;
    if (tag === 'pre' || tag === 'code') {
      const text = node.querySelector('code')?.textContent || node.textContent;
      const fence = '`'.repeat(Math.max(tag === 'pre' ? 3 : 1, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return tag === 'pre' ? `\n\n${fence}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n` : `${fence} ${text} ${fence}`;
    }
    if (tag === 'span' && node.querySelector('math') && node.querySelector('annotation[encoding="application/x-tex"]')) return `$${node.querySelector('annotation[encoding="application/x-tex"]').textContent}$`;
    if (tag === 'img') return `![${(node.getAttribute('alt') || '图片').replace(/[\[\]]/g, '')}](${node.getAttribute('src') || ''})`;
    if (tag === 'a') return node.hasAttribute('href') ? `[${children().replace(/[\[\]]/g, '\\$&')}](${node.getAttribute('href').replace(/\(/g, '%28').replace(/\)/g, '%29')})` : children();
    if (tag === 'br') return '\n';
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children()}\n\n`;
    if (['strong', 'b'].includes(tag)) return `**${children()}**`;
    if (['em', 'i'].includes(tag)) return `*${children()}*`;
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'blockquote') return '\n\n' + children().trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (tag === 'ul' || tag === 'ol') return '\n' + [...node.children].map((li, i) => `${tag === 'ol' ? (Number(node.getAttribute('start')) || 1) + i + '.' : '-'} ${[...li.childNodes].map(toMarkdown).join('').trim().replace(/\n/g, '\n  ')}\n`).join('') + '\n';
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(cell => toMarkdown(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
      if (!rows.length) return '';
      rows.splice(1, 0, rows[0].map(() => '---')); return '\n\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
    }
    return ['p', 'div', 'article', 'section', 'figure'].includes(tag) ? `\n\n${children()}\n\n` : children();
  }
  globalThis.keepChat = {version: 10, inspect, capture, prepareImage, verifyImage, cancel(job) { if (running?.job === job) running.controller.abort(new Error('已取消读取，可以重新开始。')); }};
})();
