import * as vscode from 'vscode';
import { SessionStore } from './search/searchService';
import { SearchPanel } from './ui/searchPanel';
import { SessionPreview } from './ui/sessionPreview';

export function activate(context: vscode.ExtensionContext): void {
  const store = new SessionStore();
  const preview = new SessionPreview(context, store);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionSearch.open', () => {
      SearchPanel.show(context, store, preview);
    }),
  );

  const item = vscode.window.createStatusBarItem('claudeSessionSearch.status', vscode.StatusBarAlignment.Right, 100);
  item.name = 'Claude Session Search';
  item.text = '$(search) Claude Search';
  item.tooltip = '搜索所有本地 Claude Code 历史对话（本地执行，不调用 LLM）';
  item.command = 'claudeSessionSearch.open';
  item.show();
  context.subscriptions.push(item);
}

export function deactivate(): void {
  // nothing to clean up
}
