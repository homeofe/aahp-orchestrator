import * as vscode from 'vscode'
import * as path from 'path'
import { loadAahpContext, getWorkspaceRoot, AahpContext } from './aahp-reader'
import { createStatusBar, updateStatusBar } from './statusbar'
import { registerChatParticipant } from './chat-participant'
import { registerContextInjector } from './context-injector'
import { AahpDashboardProvider } from './sidebar'
import { registerCommands } from './commands'

// ── Shared state ──────────────────────────────────────────────────────────────

let currentCtx: AahpContext | undefined

function reloadContext(): void {
  const root = getWorkspaceRoot()
  currentCtx = root ? loadAahpContext(root) : undefined
}

function getCtx(): AahpContext | undefined {
  return currentCtx
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

  // ── Chat participant (@aahp) ─────────────────────────────────────────────────
  context.subscriptions.push(
    registerChatParticipant(context, getCtx)
  )

  // ── Context injector ────────────────────────────────────────────────────────
  for (const d of registerContextInjector(context, getCtx)) {
    context.subscriptions.push(d)
  }

  // ── Commands ────────────────────────────────────────────────────────────────
  for (const d of registerCommands(context, getCtx, () => {
    reloadContext()
    updateStatusBar(statusBar, currentCtx)
    dashboardProvider.update(currentCtx)
  })) {
    context.subscriptions.push(d)
  }

  // ── File watcher: live-reload manifest on change (any subdir) ───────────────
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/.ai/handoff/MANIFEST.json'
  )
  const onManifestChange = () => {
    reloadContext()
    updateStatusBar(statusBar, currentCtx)
    dashboardProvider.update(currentCtx)
  }
  watcher.onDidChange(onManifestChange)
  watcher.onDidCreate(onManifestChange)
  watcher.onDidDelete(onManifestChange)
  context.subscriptions.push(watcher)

  // ── Re-resolve context when active editor changes (user switches repo) ───────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      reloadContext()
      updateStatusBar(statusBar, currentCtx)
      dashboardProvider.update(currentCtx)
    })
  )

  // ── Workspace folder change ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      reloadContext()
      updateStatusBar(statusBar, currentCtx)
      dashboardProvider.update(currentCtx)
    })
  )

  console.log('AAHP Orchestrator activated', currentCtx ? `— project: ${currentCtx.manifest.project}` : '— no AAHP context')
}

export function deactivate(): void {}
