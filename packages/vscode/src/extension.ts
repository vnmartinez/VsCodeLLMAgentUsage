import * as vscode from 'vscode';
import { buildViewModel, createDefaultCollector, statusBarText, worstBand, type AgentId } from '@agent-usage/core';
import { tooltipMarkdown } from './tooltip';

function intervals(): Partial<Record<AgentId, number>> {
  const config = vscode.workspace.getConfiguration('agentUsage');
  const local = config.get<number>('localIntervalSeconds', 60) * 1000;
  return { claude: config.get<number>('claudeIntervalSeconds', 300) * 1000, codex: local, antigravity: local };
}

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.name = 'Agent Usage';
  item.command = 'agentUsage.refresh';
  item.text = '$(pulse) …';
  item.show();

  const collector = createDefaultCollector({ intervalsMs: intervals() });
  const version = context.extension.packageJSON.version as string;

  const render = () => {
    const snaps = collector.current();
    item.text = statusBarText(snaps);
    item.tooltip = new vscode.MarkdownString(tooltipMarkdown(buildViewModel(snaps, new Date()), version));
    const band = worstBand(snaps);
    item.backgroundColor =
      band === 'critical'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : band === 'warning'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
  };

  const unsubscribe = collector.subscribe(render);
  const tick = setInterval(render, 30_000); // mantém as contagens regressivas atualizadas

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('agentUsage.refresh', () => collector.refreshNow({ force: true })),
    {
      dispose: () => {
        unsubscribe();
        clearInterval(tick);
        collector.stop();
      },
    },
  );

  void collector.start();
}

export function deactivate(): void {}
