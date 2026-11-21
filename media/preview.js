// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  const target = Number(document.body.dataset.target);
  const query = (document.body.dataset.query || '').trim();

  document.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button.copy');
    if (!btn) return;
    const kind = btn.getAttribute('data-copy');
    if (kind === 'message') {
      vscode.postMessage({ type: 'copyMessage', index: Number(btn.getAttribute('data-index')) });
    } else if (kind === 'sessionId') {
      vscode.postMessage({ type: 'copySessionId' });
    } else if (kind === 'filePath') {
      vscode.postMessage({ type: 'copyFilePath' });
    }
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => (btn.textContent = old), 1200);
  });

  /** Highlight query occurrences inside an element using the CSS Custom Highlight API (no DOM mutation). */
  function highlightIn(el) {
    // @ts-ignore
    if (!query || typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return null;
    const needle = query.toLowerCase();
    const ranges = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.nodeValue || '').toLowerCase();
      let i = text.indexOf(needle);
      while (i >= 0) {
        const r = new Range();
        r.setStart(node, i);
        r.setEnd(node, i + needle.length);
        ranges.push(r);
        i = text.indexOf(needle, i + needle.length);
      }
    }
    if (ranges.length) {
      // @ts-ignore
      CSS.highlights.set('query', new Highlight(...ranges));
    }
    return ranges[0] || null;
  }

  function locate() {
    if (!(target >= 0)) return;
    const el = document.getElementById('msg-' + target);
    if (!el) return;
    const firstHit = highlightIn(el);
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.8;
    if (tall && firstHit) {
      const rect = firstHit.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3 });
    } else {
      el.scrollIntoView({ block: tall ? 'start' : 'center' });
    }
  }

  // Wait a frame so layout is complete before scrolling.
  requestAnimationFrame(() => requestAnimationFrame(locate));
})();
