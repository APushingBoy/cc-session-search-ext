import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionStore, buildSnippet, findTargetIndex, searchSessions } from '../src/search/searchService';
import { FIXTURES, PROJECTS, SESSION_A } from './helpers';

async function loadedStore(dir = PROJECTS) {
  const store = new SessionStore(() => dir);
  const status = await store.ensureLoaded();
  return { store, status };
}

test('store loads all fixture sessions across projects', async () => {
  const { store, status } = await loadedStore();
  assert.equal(status.exists, true);
  assert.equal(status.sessionCount, 2);
  assert.equal(store.getSessions().length, 2);
  assert.ok(store.isKnownFile(SESSION_A));
});

test('Chinese keyword matches across projects', async () => {
  const { store } = await loadedStore();
  const r = searchSessions(store.getSessions(), { query: '公钥', role: 'all' });
  const projects = new Set(r.results.map((x) => x.projectName));
  assert.ok(projects.has('gateway-agent'));
  assert.ok(projects.has('remote-workspace'));
  assert.equal(r.total, r.results.length);
});

test('English matching is case-insensitive; mixed CJK/Latin works', async () => {
  const { store } = await loadedStore();
  const lower = searchSessions(store.getSessions(), { query: 'ssh', role: 'all' });
  const upper = searchSessions(store.getSessions(), { query: 'SSH', role: 'all' });
  assert.equal(lower.total, upper.total);
  assert.ok(lower.total >= 4);
  const mixed = searchSessions(store.getSessions(), { query: 'SSH 公钥', role: 'all' });
  assert.equal(mixed.total, 1);
  assert.equal(mixed.results[0].projectName, 'remote-workspace');
});

test('code / identifier search: authorized_keys', async () => {
  const { store } = await loadedStore();
  const r = searchSessions(store.getSessions(), { query: 'authorized_keys', role: 'all' });
  assert.equal(r.total, 2);
  assert.ok(r.results.every((x) => x.role === 'assistant'));
});

test('internal content (tool results, thinking) is not searchable', async () => {
  const { store } = await loadedStore();
  for (const q of ['TOOL_RESULT_MARKER', 'SECRET_THINKING', 'TOOL_INPUT_MARKER', 'IDE_MARKER']) {
    assert.equal(searchSessions(store.getSessions(), { query: q, role: 'all' }).total, 0, q);
  }
});

test('role filter', async () => {
  const { store } = await loadedStore();
  const all = searchSessions(store.getSessions(), { query: 'ssh', role: 'all' });
  const user = searchSessions(store.getSessions(), { query: 'ssh', role: 'user' });
  const asst = searchSessions(store.getSessions(), { query: 'ssh', role: 'assistant' });
  assert.ok(user.results.every((x) => x.role === 'user'));
  assert.ok(asst.results.every((x) => x.role === 'assistant'));
  assert.equal(user.total + asst.total, all.total);
  assert.ok(user.total > 0 && asst.total > 0);
});

test('results are newest first and carry message locators', async () => {
  const { store } = await loadedStore();
  const r = searchSessions(store.getSessions(), { query: 'ssh', role: 'all' });
  const times = r.results.map((x) => x.time ?? -Infinity);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const top = r.results[0];
  const session = store.getSession(top.filePath)!;
  const idx = findTargetIndex(session, top.messageKey, top.line);
  assert.equal(idx, top.messageIndex);
  assert.ok(session.messages[idx].text.toLowerCase().includes('ssh'));
});

test('locating uses key, then line — not text (duplicate texts)', async () => {
  const { store } = await loadedStore();
  const r = searchSessions(store.getSessions(), { query: 'same text twice', role: 'user' });
  assert.equal(r.total, 2);
  const [a, b] = r.results;
  assert.notEqual(a.messageKey, b.messageKey);
  const session = store.getSession(a.filePath)!;
  assert.equal(findTargetIndex(session, a.messageKey, a.line), a.messageIndex);
  assert.equal(findTargetIndex(session, b.messageKey, b.line), b.messageIndex);
  // Unknown key falls back to line.
  assert.equal(findTargetIndex(session, 'nope', b.line), b.messageIndex);
  assert.equal(findTargetIndex(session, 'nope', 99999), -1);
});

test('empty query and no-hit queries return no results', async () => {
  const { store } = await loadedStore();
  assert.equal(searchSessions(store.getSessions(), { query: '', role: 'all' }).total, 0);
  assert.equal(searchSessions(store.getSessions(), { query: '   ', role: 'all' }).total, 0);
  assert.equal(searchSessions(store.getSessions(), { query: 'zzz-no-such-text-zzz', role: 'all' }).total, 0);
});

test('regex metacharacters are treated literally', async () => {
  const { store } = await loadedStore();
  assert.equal(searchSessions(store.getSessions(), { query: '.*', role: 'all' }).total, 0);
  assert.equal(searchSessions(store.getSessions(), { query: '`ssh-keygen`', role: 'all' }).total, 1);
});

test('limit caps returned results but total reflects all hits', async () => {
  const { store } = await loadedStore();
  const r = searchSessions(store.getSessions(), { query: 'ssh', role: 'all', limit: 1 });
  assert.equal(r.results.length, 1);
  assert.ok(r.total > 1);
});

test('snippet centers on the match and highlights it', () => {
  const text = 'a'.repeat(500) + ' Hello SSH World ' + 'b'.repeat(500);
  const s = buildSnippet(text, 'ssh');
  assert.ok(s.text.startsWith('…'));
  assert.ok(s.text.endsWith('…'));
  assert.equal(s.highlights.length, 1);
  const [start, end] = s.highlights[0];
  assert.equal(s.text.slice(start, end), 'SSH');
});

test('snippet collapses whitespace and highlights all occurrences', () => {
  const s = buildSnippet('ssh\n\nfoo   SSH bar', 'ssh');
  assert.equal(s.text, 'ssh foo SSH bar');
  assert.deepEqual(s.highlights, [
    [0, 3],
    [8, 11],
  ]);
});

test('missing projects dir and empty projects dir', async () => {
  const missing = await loadedStore(path.join(FIXTURES, 'does-not-exist'));
  assert.equal(missing.status.exists, false);
  assert.equal(missing.status.sessionCount, 0);
  const empty = await loadedStore(path.join(FIXTURES, 'empty-projects'));
  assert.equal(empty.status.exists, true);
  assert.equal(empty.status.sessionCount, 0);
  assert.equal(searchSessions(empty.store.getSessions(), { query: 'ssh', role: 'all' }).total, 0);
});

test('refresh picks up new files and drops deleted ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'css-test-'));
  try {
    const proj = path.join(dir, '-p');
    fs.mkdirSync(proj);
    const f1 = path.join(proj, 's1.jsonl');
    fs.writeFileSync(f1, JSON.stringify({ type: 'user', uuid: 'a', message: { role: 'user', content: 'alpha' } }) + '\n');
    const store = new SessionStore(() => dir);
    await store.ensureLoaded();
    assert.equal(searchSessions(store.getSessions(), { query: 'alpha', role: 'all' }).total, 1);

    fs.unlinkSync(f1);
    fs.writeFileSync(path.join(proj, 's2.jsonl'), JSON.stringify({ type: 'user', uuid: 'b', message: { role: 'user', content: 'beta' } }) + '\n');
    const status = await store.refresh();
    assert.equal(status.sessionCount, 1);
    assert.equal(searchSessions(store.getSessions(), { query: 'alpha', role: 'all' }).total, 0);
    assert.equal(searchSessions(store.getSessions(), { query: 'beta', role: 'all' }).total, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
