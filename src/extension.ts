import * as vscode from 'vscode'
import * as path from 'path'
import { loadAahpContext, getWorkspaceRoot, AahpContext, scanAllRepoOverviews } from './aahp-reader'
import { createStatusBar, updateStatusBar, createAgentStatusBar, updateAgentStatusBar } from './statusbar'
import { registerChatParticipant } from './chat-participant'
import { registerContextInjector } from './context-injector'
import { AahpDashboardProvider } from './sidebar'
import { registerCommands } from './commands'
import { AgentRun, getDevRoot } from './agent-spawner'
import { SessionMonitor } from './session-monitor'
import { TaskTreeProvider } from './task-tree'
import { AgentLogStore } from './agent-log'

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

  const agentStatusBar = createAgentStatusBar()
  context.subscriptions.push(agentStatusBar)

  // ── Sidebar / Dashboard ─────────────────────────────────────────────────────
  const dashboardProvider = new AahpDashboardProvider(context.extensionUri)

  // ── All Open Tasks tree view ──────────────────────────────────────────────
  const taskTreeProvider = new TaskTreeProvider()

  // ── Define refreshAll BEFORE registering providers ────────────────────────
  // IMPORTANT: registerWebviewViewProvider may immediately call resolveWebviewView
  // if the sidebar was visible when VS Code was last closed. The refresh callback
  // MUST be set before that happens, otherwise the dashboard renders empty on startup.
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

  // Set the refresh callback BEFORE registering the webview provider to prevent
  // the race condition where resolveWebviewView fires before the callback exists
  dashboardProvider.setRefreshCallback(refreshAll)
  dashboardProvider.update(currentCtx)

  // NOW register providers - VS Code may immediately call resolveWebviewView here,
  // but the refresh callback is already set so the dashboard will populate correctly
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aahp.dashboard', dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )
  context.subscriptions.push(
    vscode.window.createTreeView('aahp.allTasks', { treeDataProvider: taskTreeProvider })
  )

  // ── One-time development-root prompt ─────────────────────────────────────────
  if (!currentCtx) {
    promptDevRootIfNeeded(context).then(() => refreshAll())
  }

  // ── Clean startup: full refresh after all providers are registered ──────────
  // Without this, the dashboard renders with incomplete state (no repo overviews,
  // no focused repo, stale session data) because the initial activation only
  // calls dashboardProvider.update() before scanAllRepoOverviews() is available.
  refreshAll()

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

  // Register onChange BEFORE clearing stale data so the dashboard is notified
  monitor.onChange(() => {
    const sessions = monitor.getActiveSessions()
    const queue = monitor.getQueue()
    dashboardProvider.updateSessionState(sessions, queue)
  })

  await monitor.clearStaleSessions()
  await monitor.clearQueue()  // also clear any tasks stuck in queue from previous stale sessions

  // ── Agent Log Store ────────────────────────────────────────────────────────
  const logStore = new AgentLogStore(context.globalState, context.globalStorageUri)

  // Feed initial log history to dashboard
  dashboardProvider.updateLogHistory(logStore.getHistory(5))

  // ── Commands ────────────────────────────────────────────────────────────────
  for (const d of registerCommands(context, getCtx, refreshAll, (runs: AgentRun[]) => {
    dashboardProvider.updateAgentRuns(runs)
    updateAgentStatusBar(agentStatusBar, runs)
    // Refresh log history when runs change (captures newly finished agents)
    dashboardProvider.updateLogHistory(logStore.getHistory(5))
  }, monitor, dashboardProvider, taskTreeProvider, logStore)) {
    context.subscriptions.push(d)
  }

  // ── Final refresh after all async initialization is complete ────────────────
  // This catches the case where resolveWebviewView fired during the awaits above
  // but before session monitor / log store data was available. Now all state is
  // populated, so this render will be complete.
  refreshAll()

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

  // ── Extension conflict detection ─────────────────────────────────────────────
  // Warn if conflicting AAHP extensions are installed (duplicate command IDs break
  // context menus and command routing)
  const conflicting = vscode.extensions.all.filter(ext => {
    if (ext.id === 'elvatis.aahp-orchestrator') return false // that's us
    return ext.id.includes('aahp') && ext.id !== 'elvatis.aahp-orchestrator'
  })
  if (conflicting.length > 0) {
    const names = conflicting.map(e => e.id).join(', ')
    vscode.window.showWarningMessage(
      `AAHP Orchestrator: Conflicting extensions detected (${names}). ` +
      'These may break context menus and commands. Uninstall old AAHP extensions for best results.',
      'Uninstall Conflicts',
      'Dismiss'
    ).then(async choice => {
      if (choice === 'Uninstall Conflicts') {
        for (const ext of conflicting) {
          try {
            await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', ext.id)
          } catch { /* best-effort */ }
        }
        vscode.window.showInformationMessage('AAHP: Conflicting extensions removed. Please reload VS Code.')
      }
    })
  }

  console.log('AAHP Orchestrator activated', currentCtx ? `- project: ${currentCtx.manifest.project}` : '- no AAHP context')
}

export function deactivate(): void {}

