// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  const PAGE_SIZE = 100;
  const DEBOUNCE_MS = 250;

  const input = /** @type {HTMLInputElement} */ (document.getElementById('query'));
  const refreshBtn = /** @type {HTMLButtonElement} */ (document.getElementById('refresh'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
  const resultsEl = /** @type {HTMLElement} */ (document.getElementById('results'));
  const filterBtns = /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll('.filter')));

  const saved = vscode.getState() || {};
  let role = ['all', 'user', 'assistant'].includes(saved.role) ? saved.role : 'all';
  let requestId = 0;
  let debounceTimer = 0;
  /** @type {any[]} */
  let results = [];
  let rendered = 0;
  let total = 0;
  /** @type {any} */
  let loadStatus = null;
  let lastQuery = '';

  input.value = typeof saved.query === 'string' ? saved.query : '';

  function saveState() {
    vscode.setState({ query: input.value, role });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setRole(next) {
    role = next;
    for (const b of filterBtns) {
      const on = b.dataset.role === role;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  setRole(role);

  function idleStatusText() {
    if (!loadStatus) return '正在加载会话…';
    if (!loadStatus.exists) return '';
    let s = `已加载 ${loadStatus.sessionCount} 个会话，${loadStatus.messageCount} 条消息`;
    if (loadStatus.failedFiles) s += `（${loadStatus.failedFiles} 个文件无法读取，已跳过）`;
    return s;
  }

  function showEmptyState() {
    resultsEl.textContent = '';
    const box = document.createElement('div');
    box.className = 'empty';
    if (loadStatus && !loadStatus.exists) {
      box.appendChild(textEl('div', '未找到 Claude Code 数据目录', 'empty-title'));
      box.appendChild(textEl('div', loadStatus.projectsDir, 'empty-path'));
      box.appendChild(textEl('div', '请确认已安装并使用过 Claude Code；如使用了自定义配置目录，请设置 CLAUDE_CONFIG_DIR 环境变量。'));
    } else if (loadStatus && loadStatus.sessionCount === 0) {
      box.appendChild(textEl('div', '还没有任何 Claude Code 会话', 'empty-title'));
      box.appendChild(textEl('div', loadStatus.projectsDir, 'empty-path'));
    } else {
      box.appendChild(textEl('div', '输入关键词，搜索所有项目中的 Claude Code 历史对话'));
    }
    resultsEl.appendChild(box);
  }

  /** @returns {HTMLElement} */
  function textEl(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function doSearch(isRefresh) {
    window.clearTimeout(debounceTimer);
    saveState();
    const query = input.value.trim();
    requestId++;
    if (!query && !isRefresh) {
      results = [];
      total = 0;
      lastQuery = '';
      setStatus(idleStatusText());
      showEmptyState();
      return;
    }
    vscode.postMessage({ type: isRefresh ? 'refresh' : 'search', requestId, query, role });
  }

  input.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => doSearch(false), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(false);
    } else if (e.key === 'ArrowDown') {
      const first = resultsEl.querySelector('.result');
      if (first) {
        e.preventDefault();
        /** @type {HTMLElement} */ (first).focus();
      }
    }
  });
  for (const b of filterBtns) {
    b.addEventListener('click', () => {
      setRole(b.dataset.role);
      doSearch(false);
      input.focus();
    });
  }
  refreshBtn.addEventListener('click', () => {
    refreshBtn.disabled = true;
    doSearch(true);
  });

  function renderSnippet(container, snippet) {
    const text = String(snippet.text || '');
    let pos = 0;
    for (const [s, e] of snippet.highlights || []) {
      if (s < pos) continue;
      if (s > pos) container.appendChild(document.createTextNode(text.slice(pos, s)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(s, e);
      container.appendChild(mark);
      pos = e;
    }
    if (pos < text.length) container.appendChild(document.createTextNode(text.slice(pos)));
  }

  function renderItem(r) {
    const item = document.createElement('div');
    item.className = 'result';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const head = document.createElement('div');
    head.className = 'result-head';
    head.appendChild(textEl('span', r.title || '(无标题会话)', 'title'));
    head.appendChild(textEl('span', r.time, 'time'));
    item.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.appendChild(textEl('span', r.projectName, 'project'));
    meta.appendChild(textEl('span', '·', 'sep'));
    meta.appendChild(textEl('span', r.role === 'user' ? '用户提问' : 'Claude 回复', 'role ' + r.role));
    if (r.cwd) {
      meta.appendChild(textEl('span', '·', 'sep'));
      const cwd = textEl('span', r.cwd, 'cwd');
      cwd.title = r.cwd; // full path on hover
      meta.appendChild(cwd);
    }
    item.appendChild(meta);

    const snip = document.createElement('div');
    snip.className = 'snippet';
    renderSnippet(snip, r.snippet || { text: '', highlights: [] });
    item.appendChild(snip);

    const open = () =>
      vscode.postMessage({ type: 'open', filePath: r.filePath, messageKey: r.messageKey, line: r.line, query: lastQuery });
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let sib = e.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
        while (sib && !sib.classList.contains('result')) {
          sib = e.key === 'ArrowDown' ? sib.nextElementSibling : sib.previousElementSibling;
        }
        if (sib) /** @type {HTMLElement} */ (sib).focus();
        else if (e.key === 'ArrowUp') input.focus();
      }
    });
    return item;
  }

  function renderMore() {
    const moreBtn = resultsEl.querySelector('.more');
    if (moreBtn) moreBtn.remove();
    const frag = document.createDocumentFragment();
    const end = Math.min(results.length, rendered + PAGE_SIZE);
    for (let i = rendered; i < end; i++) frag.appendChild(renderItem(results[i]));
    rendered = end;
    resultsEl.appendChild(frag);
    if (rendered < results.length) {
      const btn = textEl('button', `显示更多（剩余 ${results.length - rendered} 条）`, 'more');
      btn.addEventListener('click', renderMore);
      resultsEl.appendChild(btn);
    }
  }

  function showResults() {
    resultsEl.textContent = '';
    resultsEl.scrollTop = 0;
    rendered = 0;
    if (!lastQuery) {
      showEmptyState();
      return;
    }
    if (results.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      if (loadStatus && !loadStatus.exists) {
        showEmptyState();
        return;
      }
      box.appendChild(textEl('div', `没有找到包含 “${lastQuery}” 的消息`));
      resultsEl.appendChild(box);
      return;
    }
    renderMore();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'focus':
        input.focus();
        break;
      case 'progress':
        if (msg.total > 0) setStatus(`正在扫描会话文件… ${msg.done}/${msg.total}`, 'busy');
        break;
      case 'status':
        loadStatus = msg.status;
        if (input.value.trim()) doSearch(false);
        else {
          setStatus(idleStatusText());
          showEmptyState();
        }
        break;
      case 'searching':
        if (msg.requestId === requestId) setStatus(msg.refresh ? '正在刷新…' : '正在搜索…', 'busy');
        break;
      case 'results': {
        if (msg.requestId !== requestId) return; // stale response
        refreshBtn.disabled = false;
        loadStatus = msg.status;
        results = Array.isArray(msg.results) ? msg.results : [];
        total = msg.total || 0;
        lastQuery = input.value.trim();
        let s = lastQuery
          ? total > results.length
            ? `找到 ${total} 条匹配消息，显示最新的 ${results.length} 条`
            : `找到 ${total} 条匹配消息`
          : idleStatusText();
        if (msg.refreshed) s = '刷新完成 · ' + (lastQuery ? s : idleStatusText());
        setStatus(s, msg.refreshed ? 'ok' : '');
        showResults();
        break;
      }
      case 'error':
        refreshBtn.disabled = false;
        setStatus(String(msg.message || '发生错误'), 'error');
        break;
    }
  });

  input.focus();
  vscode.postMessage({ type: 'ready' });
})();
