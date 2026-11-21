import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { escapeHtml, renderMarkdown } from '../src/ui/markdown';

test('escapes raw HTML / script content', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('fenced code blocks are escaped and keep newlines', () => {
  const html = renderMarkdown('before\n```bash\necho "<hi>"\nls -la\n```\nafter');
  assert.ok(html.includes('<pre><code class="lang-bash">echo &quot;&lt;hi&gt;&quot;\nls -la</code></pre>'));
  assert.ok(html.includes('<p>before</p>'));
  assert.ok(html.includes('<p>after</p>'));
});

test('unterminated fence still renders as code', () => {
  const html = renderMarkdown('```\nunfinished');
  assert.ok(html.includes('<code>unfinished</code>'));
});

test('inline formatting, lists, headings', () => {
  const html = renderMarkdown('# Title\n- one **bold**\n- two `a<b`\n\n1. first\n\nline1\nline2');
  assert.ok(html.includes('<h1>Title</h1>'));
  assert.ok(html.includes('<ul><li>one <strong>bold</strong></li><li>two <code>a&lt;b</code></li></ul>'));
  assert.ok(html.includes('<ol><li>first</li></ol>'));
  assert.ok(html.includes('<p>line1<br>line2</p>'));
});

test('only http(s) links become anchors', () => {
  assert.ok(renderMarkdown('[x](https://example.com)').includes('<a href="https://example.com"'));
  const js = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!js.includes('<a'));
  const quoted = renderMarkdown('[x](https://e.com/"onmouseover="alert(1))');
  assert.ok(!/href="[^"]*"onmouseover/.test(quoted));
});

test('snake_case identifiers are not italicized', () => {
  const html = renderMarkdown('use authorized_keys and my_var_name');
  assert.ok(!html.includes('<em>'));
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
