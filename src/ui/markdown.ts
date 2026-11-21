/**
 * Minimal, safe Markdown -> HTML renderer for chat messages.
 * All text is HTML-escaped before any markup is added, so raw HTML in messages
 * is always shown as text. Supports: fenced code, inline code, headings, lists,
 * blockquotes, horizontal rules, bold, italic, strikethrough and http(s) links.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(src: string): string {
  // Pull out inline code first so its content is not further formatted.
  const codes: string[] = [];
  // eslint-disable-next-line no-control-regex
  let text = src.replace(/\u0000/g, '').replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = escapeHtml(text);
  // Links: [label](http...) — only http/https URLs become anchors.
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => {
    return `<a href="${url}" title="${url}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
  return text;
}

type ListKind = 'ul' | 'ol';

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: ListKind; items: string[] } | undefined;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.kind}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${list.kind}>`);
      list = undefined;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flushAll();
      const marker = fence[1];
      const lang = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
      out.push(`<div class="code-block">${label}<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushPara();
      flushList();
      quote.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }
    flushQuote();

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind: ListKind = ul ? 'ul' : 'ol';
      if (list && list.kind !== kind) {
        flushList();
      }
      list = list ?? { kind, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }

    if (list && /^\s{2,}\S/.test(line)) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();
  return out.join('\n');
}
