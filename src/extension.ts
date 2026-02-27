import * as vscode from 'vscode'
import * as path from 'path'
import { loadAahpContext, getWorkspaceRoot, AahpContext } from './aahp-reader'
import { createStatusBar, updateStatusBar } from './statusbar'
import { registerChatParticipant } from './chat-participant'
import { registerContextInjector } from './context-injector'
import { AahpDashboardProvider } from './sidebar'
import { registerCommands } from './commands'
import { AgentRun } from './agent-spawner'
import { SessionMonitor } from './session-monitor'

// ── Shared state ──────────────────────────────────────────────────────────────

let currentCtx: AahpContext | undefined

function reloadContext(): void {
  const root = getWorkspaceRoot()
  currentCtx = root ? loadAahpContext(root) : undefined
}

function getCtx(): AahpContext | undefined {
  return currentCtx
}

// ── Dev-root prompt ───────────────────────────────────────────────────────────

async function promptDevRootIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('aahp')
  if (config.get('suppressRootPrompt', false)) return
  if (config.get('developmentRoot', false)) return

  const answer = await vscode.window.showInformationMessage(
    'AAHP Orchestrator: No `.ai/handoff/MANIFEST.json` found at workspace root. ' +
    'Is this a root development folder containing multiple repos as subdirectories?',
    { modal: false },
    'Yes - scan subdirs',
    'No - single repo',
    'Set custom path…'
  )

  if (answer === 'Yes - scan subdirs') {
    await config.update('developmentRoot', true, vscode.ConfigurationTarget.Workspace)
  } else if (answer === 'No - single repo') {
    await config.update('suppressRootPrompt', true, vscode.ConfigurationTarget.Workspace)
  } else if (answer === 'Set custom path…') {
    const root = getWorkspaceRoot() ?? ''
    const entered = await vscode.window.showInputBox({
      title: 'AAHP: Root Development Folder Path',
      prompt: 'Enter the path to your root development folder (containing repos as subdirs)',
      value: root,
      placeHolder: 'e.g. E:\\_Development or /home/user/dev',
    })
    if (entered?.trim()) {
      await config.update('rootFolderPath', entered.trim(), vscode.ConfigurationTarget.Workspace)
      await config.update('developmentRoot', true, vscode.ConfigurationTarget.Workspace)
    }
  }
}

// ── Activate ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Initial load
  reloadContext()

  // ── Status bar ──────────────────────────────────────────────────────────────
  const statusBar = createStatusBar()
  updateStatusBar(statusBar, currentCtx)
  context.subscriptions.push(statusBar)

  // ── Sidebar / Dashboard ─────────────────────────────────────────────────────
  const dashboardProvider = new AahpDashboardProvider(context.extensionUri)
  dashboardProvider.update(currentCtx)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aahp.dashboard', dashboardProvider)
  )

  const refreshAll = (): void => {
    reloadContext()
    updateStatusBar(statusBar, currentCtx)
    dashboardProvider.update(currentCtx)
  }

  // ── One-time development-root prompt ─────────────────────────────────────────
  if (!currentCtx) {
    promptDevRootIfNeeded(context).then(() => refreshAll())
  }

  // ── Chat participant (@aahp) ─────────────────────────────────────────────────
  context.subscriptions.push(
    registerChatParticipant(context, getCtx)
  )

  // ── Context injector ────────────────────────────────────────────────────────
  for (const d of registerContextInjector(context, getCtx)) {
    context.subscriptions.push(d)
  }

  // ── Commands ────────────────────────────────────────────────────────────────
  for (const d of registerCommands(context, getCtx, refreshAll, (runs: AgentRun[]) => {
    dashboardProvider.updateAgentRuns(runs)
  })) {
    context.subscriptions.push(d)
  }

  // ── Re-trigger refreshAll on config change (user edits settings.json) ────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aahp')) refreshAll()
    })
  )

  // ── File watcher: live-reload manifest on change (any subdir) ───────────────
  const watcher = vscode.workspace.createFileSystemWatcher('**/.ai/handoff/MANIFEST.json')
  watcher.onDidChange(refreshAll)
  watcher.onDidCreate(refreshAll)
  watcher.onDidDelete(refreshAll)
  context.subscriptions.push(watcher)

  // ── Re-resolve context when active editor changes (user switches repo) ───────
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshAll))

  // ── Workspace folder change ──────────────────────────────────────────────────
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refreshAll))

  console.log('AAHP Orchestrator activated', currentCtx ? `- project: ${currentCtx.manifest.project}` : '- no AAHP context')
}

export function deactivate(): void {}

