import * as vscode from 'vscode'
import * as path from 'path'
import { loadAahpContext, getWorkspaceRoot, AahpContext, scanAllRepoOverviews } from './aahp-reader'
import { createStatusBar, updateStatusBar } from './statusbar'
import { registerChatParticipant } from './chat-participant'
import { registerContextInjector } from './context-injector'
import { AahpDashboardProvider } from './sidebar'
import { registerCommands } from './commands'
import { AgentRun, getDevRoot } from './agent-spawner'
import { SessionMonitor } from './session-monitor'
import { TaskTreeProvider } from './task-tree'

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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

  // ── All Open Tasks tree view ──────────────────────────────────────────────
  const taskTreeProvider = new TaskTreeProvider()
  context.subscriptions.push(
    vscode.window.createTreeView('aahp.allTasks', { treeDataProvider: taskTreeProvider })
  )

  const refreshAll = (): void => {
    reloadContext()
    updateStatusBar(statusBar, currentCtx)
    dashboardProvider.update(currentCtx)

    // Multi-repo overview scan
    const devRoot = getDevRoot()
    if (devRoot) {
      const overviews = scanAllRepoOverviews(devRoot)
      dashboardProvider.updateRepoOverviews(overviews)
      taskTreeProvider.update(overviews)
    }

    // Auto-focus based on active editor context
    if (currentCtx) {
      const repoRoot = path.dirname(path.dirname(currentCtx.handoffDir))
      dashboardProvider.updateFocusedRepo(repoRoot, currentCtx)
    }
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

  // ── Session Monitor ─────────────────────────────────────────────────────────
  const monitor = new SessionMonitor(context)
  await monitor.clearStaleSessions()
  await monitor.clearQueue()  // also clear any tasks stuck in queue from previous stale sessions

  // ── Session monitor live updates ────────────────────────────────────────────
  monitor.onChange(() => {
    const sessions = monitor.getActiveSessions()
    const queue = monitor.getQueue()
    dashboardProvider.updateSessionState(sessions, queue)
  })

  // ── Commands ────────────────────────────────────────────────────────────────
  for (const d of registerCommands(context, getCtx, refreshAll, (runs: AgentRun[]) => {
    dashboardProvider.updateAgentRuns(runs)
  }, monitor, dashboardProvider)) {
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

  // ── File watcher: live-reload when NEXT_ACTIONS.md changes ─────────────────
  const actionsWatcher = vscode.workspace.createFileSystemWatcher('**/.ai/handoff/NEXT_ACTIONS.md')
  actionsWatcher.onDidChange(refreshAll)
  actionsWatcher.onDidCreate(refreshAll)
  actionsWatcher.onDidDelete(refreshAll)
  context.subscriptions.push(actionsWatcher)

  // ── Re-resolve context when active editor changes (user switches repo) ───────
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshAll))

  // ── Workspace folder change ──────────────────────────────────────────────────
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refreshAll))

  console.log('AAHP Orchestrator activated', currentCtx ? `- project: ${currentCtx.manifest.project}` : '- no AAHP context')
}

export function deactivate(): void {}

