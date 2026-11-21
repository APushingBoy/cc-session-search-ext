import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { cleanUserText, extractUserText, parseSessionContent, parseSessionFile } from '../src/session/parser';
import { SESSION_A, SESSION_B } from './helpers';

const info = (filePath: string, projectDir = 'proj') => ({ filePath, projectDir, mtimeMs: 0, size: 0 });

test('parses a real-shaped session: metadata, title, cwd, project name', async () => {
  const s = await parseSessionFile(info(SESSION_A, '-home-user-gateway-agent'));
  assert.equal(s.sessionId, '11111111-aaaa-4bbb-8ccc-000000000001');
  assert.equal(s.cwd, '/home/user/gateway-agent');
  assert.equal(s.projectName, 'gateway-agent');
  assert.equal(s.title, 'Claude Code SSH 远程开发');
  assert.ok(s.startTime! <= s.endTime!);
});

test('extracts only real user prompts and assistant text', async () => {
  const s = await parseSessionFile(info(SESSION_A));
  const summary = s.messages.map((m) => [m.role, m.text]);
  assert.deepEqual(summary, [
    ['user', '如何配置 SSH 密钥，实现 VS Code 免密码登录？'],
    ['assistant', '可以使用 `ssh-keygen` 生成密钥，然后把公钥追加到 **authorized_keys**。'],
    ['assistant', 'Done. Your SSH key is configured.'],
    ['user', '再问一次 ssh 的事'],
  ]);
  const all = s.messages.map((m) => m.text).join('\n');
  for (const marker of [
    'SECRET_THINKING',
    'TOOL_INPUT_MARKER',
    'TOOL_RESULT_MARKER',
    'IDE_MARKER',
    'META_MARKER',
    'STDOUT_MARKER',
    'SIDECHAIN_MARKER',
    'Request interrupted',
  ]) {
    assert.ok(!all.includes(marker), `should not include ${marker}`);
  }
});

test('records uuid, line number and timestamp; dedupes repeated uuid', async () => {
  const s = await parseSessionFile(info(SESSION_A));
  const first = s.messages[0];
  assert.equal(first.uuid, 'u-1');
  assert.equal(first.key, 'u-1');
  assert.equal(first.line, 3);
  assert.equal(first.timestamp, '2025-11-20T09:42:00.000Z');
  assert.equal(first.time, Date.parse('2025-11-20T09:42:00.000Z'));
  // a-4 appears twice in the file but only once in messages.
  assert.equal(s.messages.filter((m) => m.uuid === 'a-4').length, 1);
  // Assistant text block line is anchored to the first text line of msg_A (line 5).
  assert.equal(s.messages[1].line, 5);
});

test('tolerates invalid JSON and a partially written last line', async () => {
  const s = await parseSessionFile(info(SESSION_A));
  assert.equal(s.invalidLines, 2);
  assert.equal(s.messages.length, 4);
});

test('handles string and array content, slash commands, missing timestamps', async () => {
  const s = await parseSessionFile(info(SESSION_B, '-home-user-remote-workspace'));
  assert.equal(s.projectName, 'remote-workspace'); // Windows cwd basename
  const texts = s.messages.map((m) => m.text);
  assert.ok(texts.includes('Windows 上怎么配置 SSH 公钥？')); // string content
  assert.ok(texts.includes('可以使用 PowerShell 的 Add-Content 把公钥写入 authorized_keys 文件。')); // array content
  assert.ok(texts.includes('/model opus'));
  const plain = s.messages.find((m) => m.text === 'plain string reply')!;
  assert.equal(plain.role, 'assistant');
  assert.equal(plain.time, undefined);
  // Two separate prompts with the same text (different uuids) are both kept.
  assert.equal(texts.filter((t) => t === 'same text twice').length, 2);
  // Without ai-title, title falls back to the first user prompt.
  assert.equal(s.title, 'Windows 上怎么配置 SSH 公钥？');
});

test('merges multiple text blocks of one assistant API message', () => {
  const lines = [
    { type: 'assistant', uuid: 'x1', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'part one' }] } },
    { type: 'assistant', uuid: 'x2', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'assistant', uuid: 'x3', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'part two' }] } },
  ].map((o) => JSON.stringify(o));
  const s = parseSessionContent(lines.join('\n'), info('/tmp/abc.jsonl'));
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].text, 'part one\n\npart two');
  assert.equal(s.messages[0].key, 'x1');
  assert.equal(s.sessionId, 'abc'); // falls back to file name
});

test('user record with tool_result blocks is not a user prompt', () => {
  assert.equal(
    extractUserText({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    '',
  );
  assert.equal(extractUserText({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }), 'hi');
});

test('cleanUserText strips system reminders and skips command output', () => {
  assert.equal(cleanUserText('hello <system-reminder>secret</system-reminder> world'), 'hello  world');
  assert.equal(cleanUserText('<local-command-stdout>x</local-command-stdout>'), '');
  assert.equal(cleanUserText('<bash-input>ls -la</bash-input>'), '! ls -la');
  assert.equal(cleanUserText('   '), '');
});

test('skips blank lines, non-object JSON and unknown types', () => {
  const content = ['', '   ', '42', '"str"', '[1,2]', '{"type":"mystery","foo":1}', 'null'].join('\n');
  const s = parseSessionContent(content, info('/tmp/x.jsonl'));
  assert.equal(s.messages.length, 0);
  assert.equal(s.invalidLines, 0);
});
