import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { SessionStore, searchSessions } from '../src/search/searchService';
import { resolveProjectsDir } from '../src/session/discovery';
import { SessionPreview } from '../src/ui/sessionPreview';

const EXT_ID = 'local.claude-session-search';

function webviewTabs(viewTypeFragment: string): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(viewTypeFragment));
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

const cases: Array<[string, () => Promise<void>]> = [
  ['extension activates on startup', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension not found');
    await waitFor(() => ext.isActive, 10000);
  }],
  ['command is registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('claudeSessionSearch.open'));
  }],
  ['CLAUDE_CONFIG_DIR is honoured inside the extension host', async () => {
    assert.ok(resolveProjectsDir().endsWith(path.join('fixtures', 'projects')), resolveProjectsDir());
  }],
  ['opening search creates one webview panel; reopening reuses it', async () => {
    await vscode.commands.executeCommand('claudeSessionSearch.open');
    await waitFor(() => webviewTabs('claudeSessionSearch.search').length === 1);
    await vscode.commands.executeCommand('claudeSessionSearch.open');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webviewTabs('claudeSessionSearch.search').length, 1);
    const tab = webviewTabs('claudeSessionSearch.search')[0];
    assert.equal(tab.label, 'Claude Session Search');
  }],
  ['clicking a result opens the preview beside, reused for the next result', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const store = new SessionStore();
    await store.ensureLoaded();
    const hits = searchSessions(store.getSessions(), { query: 'ssh', role: 'all' }).results;
    assert.ok(hits.length >= 2);
    const fakeContext = { extensionUri: ext.extensionUri } as vscode.ExtensionContext;
    const preview = new SessionPreview(fakeContext, store);
    await preview.show(hits[0].filePath, hits[0].messageKey, hits[0].line, 'ssh');
    await waitFor(() => webviewTabs('claudeSessionSearch.preview').length === 1);
    await preview.show(hits[1].filePath, hits[1].messageKey, hits[1].line, 'ssh');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webviewTabs('claudeSessionSearch.preview').length, 1);
    const searchTab = webviewTabs('claudeSessionSearch.search')[0];
    const previewTab = webviewTabs('claudeSessionSearch.preview')[0];
    assert.notEqual(searchTab.group.viewColumn, previewTab.group.viewColumn, 'preview should open beside');
  }],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✘ ${name}\n    ${err instanceof Error ? err.stack : err}`);
    }
  }
  console.log(`E2E: ${cases.length - failed}/${cases.length} passed`);
  if (failed) {
    throw new Error(`${failed} e2e test(s) failed`);
  }
}
