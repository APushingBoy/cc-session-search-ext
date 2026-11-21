import * as vscode from 'vscode';
import { SessionStore, findTargetIndex } from '../search/searchService';
import { parseSessionFile } from '../session/parser';
import { ParsedSession, SessionMessage } from '../session/types';
import { formatFullTime, getNonce } from './format';
import { escapeHtml, renderMarkdown } from './markdown';

type InboundMessage =
  | { type: 'copyMessage'; index: number }
  | { type: 'copySessionId' }
  | { type: 'copyFilePath' };

function parseInbound(raw: unknown): InboundMessage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  if (m.type === 'copyMessage' && typeof m.index === 'number' && Number.isInteger(m.index)) {
    return { type: 'copyMessage', index: m.index };
  }
  if (m.type === 'copySessionId' || m.type === 'copyFilePath') {
    return { type: m.type };
  }
  return undefined;
}

/** Single reusable editor-area preview of one session. */
export class SessionPreview {
  private panel?: vscode.WebviewPanel;
  private session?: ParsedSession;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: SessionStore,
  ) {}

  async show(filePath: string, messageKey: string, line: number, query: string): Promise<void> {
    let session = this.store.getSession(filePath);
    if (!session) {
      try {
        session = await parseSessionFile({ filePath, projectDir: '', mtimeMs: 0, size: 0 });
      } catch {
        void vscode.window.showErrorMessage('无法读取会话文件，它可能已被删除或没有访问权限。');
        return;
      }
    }
    this.session = session;
    const target = findTargetIndex(session, messageKey, line);

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'claudeSessionSearch.preview',
        'Claude 会话',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        {
          enableScripts: true,
          enableCommandUris: false,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        },
      );
      this.panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.session = undefined;
      });
    } else {
      this.panel.reveal(undefined, false);
    }
    const title = session.title ?? session.sessionId;
    this.panel.title = title.length > 40 ? title.slice(0, 40) + '…' : title;
    this.panel.webview.html = this.getHtml(this.panel.webview, session, target, query);
  }

  private async onMessage(raw: unknown): Promise<void> {
    const msg = parseInbound(raw);
    const session = this.session;
    if (!msg || !session) {
      return;
    }
    let text: string | undefined;
    let label = '';
    switch (msg.type) {
      case 'copyMessage':
        text = session.messages[msg.index]?.text;
        label = '消息内容';
        break;
      case 'copySessionId':
        text = session.sessionId;
        label = 'Session ID';
        break;
      case 'copyFilePath':
        text = session.filePath;
        label = 'Session 文件路径';
        break;
    }
    if (text !== undefined) {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.setStatusBarMessage(`$(check) 已复制${label}`, 2000);
    }
  }

  private renderMessage(m: SessionMessage, target: number): string {
    const isTarget = m.index === target;
    const roleLabel = m.role === 'user' ? '用户' : 'Claude';
    return `<article class="msg ${m.role}${isTarget ? ' target' : ''}" id="msg-${m.index}" data-index="${m.index}">
  <div class="msg-head">
    <span class="role">${roleLabel}</span>
    <span class="time">${escapeHtml(formatFullTime(m.time))}</span>
    <button class="copy" data-copy="message" data-index="${m.index}" title="复制消息正文">复制</button>
  </div>
  <div class="msg-body">${renderMarkdown(m.text)}</div>
</article>`;
  }

  private getHtml(webview: vscode.Webview, session: ParsedSession, target: number, query: string): string {
    const nonce = getNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const timeRange =
      session.startTime !== undefined
        ? `${formatFullTime(session.startTime)} — ${formatFullTime(session.endTime)}`
        : '未知时间';
    const notFound =
      target < 0 ? '<div class="notice">未能在当前文件中定位到目标消息，可能文件已变化，请刷新搜索。</div>' : '';
    // Data passed to the script via data-* attributes (escaped), no inline script.
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>${escapeHtml(session.title ?? session.sessionId)}</title>
</head>
<body data-target="${target}" data-query="${escapeHtml(query)}">
<header class="session-info">
  <h1>${escapeHtml(session.title ?? '(无标题会话)')}</h1>
  <dl>
    <dt>项目</dt><dd>${escapeHtml(session.projectName)}</dd>
    <dt>Session ID</dt><dd><code>${escapeHtml(session.sessionId)}</code> <button class="copy" data-copy="sessionId">复制</button></dd>
    ${session.cwd ? `<dt>工作目录</dt><dd><code>${escapeHtml(session.cwd)}</code></dd>` : ''}
    <dt>文件</dt><dd><code>${escapeHtml(session.filePath)}</code> <button class="copy" data-copy="filePath">复制</button></dd>
    <dt>时间</dt><dd>${escapeHtml(timeRange)} · ${session.messages.length} 条消息</dd>
  </dl>
  ${notFound}
</header>
<main class="messages">
${session.messages.map((m) => this.renderMessage(m, target)).join('\n')}
</main>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
