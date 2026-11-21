import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { discoverSessionFiles, resolveClaudeConfigDir, resolveProjectsDir } from '../src/session/discovery';
import { FIXTURES, PROJECTS } from './helpers';

test('defaults to ~/.claude', () => {
  const home = path.resolve('/home/tester');
  assert.equal(resolveClaudeConfigDir({}, home), path.join(home, '.claude'));
  assert.equal(resolveProjectsDir({}, home), path.join(home, '.claude', 'projects'));
});

test('CLAUDE_CONFIG_DIR takes precedence, supports ~ and quotes', () => {
  const home = path.resolve('/home/tester');
  const custom = path.resolve('/opt/claude-config');
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: custom }, home), custom);
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: `"${custom}"` }, home), custom);
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: '~/cfg' }, home), path.join(home, 'cfg'));
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: '   ' }, home), path.join(home, '.claude'));
});

test('discovers jsonl files recursively with project dir names', async () => {
  const r = await discoverSessionFiles(PROJECTS);
  assert.equal(r.exists, true);
  assert.equal(r.files.length, 2);
  const dirs = r.files.map((f) => f.projectDir).sort();
  assert.deepEqual(dirs, ['-home-user-gateway-agent', '-home-user-remote-workspace']);
  assert.ok(r.files.every((f) => f.size > 0 && f.mtimeMs > 0));
});

test('missing directory reports exists=false without throwing', async () => {
  const r = await discoverSessionFiles(path.join(FIXTURES, 'nope'));
  assert.equal(r.exists, false);
  assert.equal(r.files.length, 0);
});

test('empty directory reports no files', async () => {
  const r = await discoverSessionFiles(path.join(FIXTURES, 'empty-projects'));
  assert.equal(r.exists, true);
  assert.equal(r.files.length, 0);
});
