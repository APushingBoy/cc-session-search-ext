import * as vscode from 'vscode';
import { RoleFilter, SearchResult, SessionStore, searchSessions } from '../search/searchService';
import { formatTime, getNonce } from './format';
import { SessionPreview } from './sessionPreview';

/** Messages the webview may send. Anything else is ignored. */
type InboundMessage =
  | { type: 'ready' }
  | { type: 'search'; requestId: number; query: string; role: RoleFilter }
  | { type: 'refresh'; requestId: number; query: string; role: RoleFilter }
  | { type: 'open'; filePath: string; messageKey: string; line: number; query: string };

const ROLES: RoleFilter[] = ['all', 'user', 'assistant'];

function parseInbound(raw: unknown): InboundMessage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'search':
    case 'refresh':
      if (
        typeof m.requestId === 'number' &&
        typeof m.query === 'string' &&
        m.query.length <= 1000 &&
        ROLES.includes(m.role as RoleFilter)
      ) {
        return { type: m.type, requestId: m.requestId, query: m.query, role: m.role as RoleFilter };
      }
      return undefined;
    case 'open':
      if (
        typeof m.filePath === 'string' &&
        typeof m.messageKey === 'string' &&
        typeof m.line === 'number' &&
        typeof m.query === 'string'
      ) {
        return { type: 'open', filePath: m.filePath, messageKey: m.messageKey, line: m.line, query: m.query.slice(0, 1000) };
      }
      return undefined;
    default:
      return undefined;
  }
}

export class SearchPanel {
  private static current: SearchPanel | undefined;
  private latestRequestId = 0;
  private disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, store: SessionStore, preview: SessionPreview): void {
    if (SearchPanel.current) {
      SearchPanel.current.panel.reveal(undefined, false);
      SearchPanel.current.post({ type: 'focus' });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'claudeSessionSearch.search',
      'Claude Session Search',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        enableCommandUris: false,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    SearchPanel.current = new SearchPanel(panel, context, store, preview);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly store: SessionStore,
    private readonly preview: SessionPreview,
  ) {
    panel.webview.html = this.getHtml(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw), undefined, this.disposables);
    panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) {
          this.post({ type: 'focus' });
        }
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private dispose(): void {
    SearchPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(raw: unknown): Promise<void> {
    const msg = parseInbound(raw);
    if (!msg) {
      return;
    }
    try {
      switch (msg.type) {
        case 'ready': {
          const status = await this.store.ensureLoaded((done, total) =>
            this.post({ type: 'progress', done, total }),
          );
          this.post({ type: 'status', status });
          return;
        }
        case 'search':
          await this.runSearch(msg.requestId, msg.query, msg.role, false);
          return;
        case 'refresh':
          await this.runSearch(msg.requestId, msg.query, msg.role, true);
          return;
        case 'open': {
          // Only open files that discovery found — never arbitrary paths from the webview.
          if (!this.store.isKnownFile(msg.filePath)) {
            void vscode.window.showWarningMessage('该会话文件已不存在，请刷新后重试。');
            return;
          }
          await this.preview.show(msg.filePath, msg.messageKey, msg.line, msg.query);
          return;
        }
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.post({ type: 'error', message: text });
    }
  }

  private async runSearch(requestId: number, query: string, role: RoleFilter, refresh: boolean): Promise<void> {
    this.latestRequestId = Math.max(this.latestRequestId, requestId);
    this.post({ type: 'searching', requestId, refresh });
    const onProgress = (done: number, total: number) => this.post({ type: 'progress', done, total });
    let status;
    try {
      status = refresh ? await this.store.refresh(onProgress) : await this.store.ensureLoaded(onProgress);
    } catch (err) {
      this.post({ type: 'error', requestId, message: '扫描会话失败：' + (err instanceof Error ? err.message : String(err)) });
      return;
    }
    if (requestId !== this.latestRequestId) {
      return; // a newer request superseded this one
    }
    const response = searchSessions(this.store.getSessions(), { query, role });
    const now = new Date();
    this.post({
      type: 'results',
      requestId,
      refreshed: refresh,
      status,
      total: response.total,
      results: response.results.map((r: SearchResult) => ({
        filePath: r.filePath,
        messageKey: r.messageKey,
        line: r.line,
        role: r.role,
        projectName: r.projectName,
        cwd: r.cwd ?? '',
        title: r.title ?? r.sessionId,
        time: formatTime(r.time, now),
        snippet: r.snippet,
      })),
    });
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'search.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'search.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Claude Session Search</title>
</head>
<body>
<header class="toolbar">
  <div class="search-row">
    <input id="query" type="search" placeholder="搜索所有 Claude Code 对话..." autocomplete="off" spellcheck="false" aria-label="搜索关键词">
    <button id="refresh" class="icon-button" title="重新扫描会话文件" aria-label="刷新">⟳ 刷新</button>
  </div>
  <div class="filters" role="radiogroup" aria-label="消息角色">
    <button class="filter active" data-role="all" role="radio" aria-checked="true">全部</button>
    <button class="filter" data-role="user" role="radio" aria-checked="false">用户提问</button>
    <button class="filter" data-role="assistant" role="radio" aria-checked="false">Claude 回复</button>
  </div>
  <div id="status" class="status" aria-live="polite">正在加载会话…</div>
</header>
<main id="results" class="results"></main>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
