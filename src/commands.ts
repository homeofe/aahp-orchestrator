import * as vscode from 'vscode'
import * as path from 'path'
import {
  AahpContext,
  loadAahpContext,
  refreshManifestChecksums,
  saveManifest,
  getWorkspaceRoot,
} from './aahp-reader'
import { scanAllRepos, spawnAllAgents, getDevRoot, AgentRun } from './agent-spawner'
const PHASES = ['research', 'architecture', 'implementation', 'review', 'fix', 'release']

export function registerCommands(
  context: vscode.ExtensionContext,
  getCtx: () => AahpContext | undefined,
  reloadCtx: () => void,
  onAgentRuns?: (runs: AgentRun[]) => void
): vscode.Disposable[] {
  return [

    // ── Update Manifest Checksums ─────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.updateManifest', async () => {
      const ctx = getCtx()
      if (!ctx) {
        vscode.window.showWarningMessage('AAHP: No MANIFEST.json found.')
        return
      }
      const updated = refreshManifestChecksums(ctx)
      saveManifest(ctx, updated)
      reloadCtx()
      vscode.window.showInformationMessage('AAHP: Manifest checksums updated ✓')
    }),

    // ── Commit Session ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.commitSession', async () => {
      const root = getWorkspaceRoot()
      if (!root) { vscode.window.showWarningMessage('AAHP: No workspace open.'); return }
      const ctx = getCtx()
      if (!ctx) { vscode.window.showWarningMessage('AAHP: No MANIFEST.json found.'); return }

      // Update checksums first
      const updated = refreshManifestChecksums(ctx)
      saveManifest(ctx, updated)

      const msg = await vscode.window.showInputBox({
        prompt: 'Commit message',
        value: `docs(aahp): update session - ${ctx.manifest.last_session.phase}`,
        placeHolder: 'docs(aahp): ...',
      })
      if (!msg) return

      const terminal = vscode.window.createTerminal({ name: 'AAHP Commit', cwd: root })
      terminal.sendText(`git add .ai/handoff/ && git commit -m "${msg.replace(/"/g, '\\"')}" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`)
      terminal.show()
    }),

    // ── Set Phase ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.setPhase', async () => {
      const ctx = getCtx()
      if (!ctx) { vscode.window.showWarningMessage('AAHP: No MANIFEST.json found.'); return }

      const picked = await vscode.window.showQuickPick(PHASES, {
        placeHolder: `Current: ${ctx.manifest.last_session.phase}`,
        title: 'Set AAHP Phase',
      })
      if (!picked) return

      const updated = {
        ...ctx.manifest,
        last_session: {
          ...ctx.manifest.last_session,
          phase: picked,
          timestamp: new Date().toISOString(),
        },
      }
      saveManifest(ctx, updated)
      reloadCtx()
      vscode.window.showInformationMessage(`AAHP: Phase set to "${picked}" ✓`)
    }),

    // ── Open Dashboard ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.openDashboard', () => {
      vscode.commands.executeCommand('aahp.dashboard.focus')
    }),

    // ── Run All Agents ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.runAll', async () => {
      const devRoot = getDevRoot()
      if (!devRoot) {
        vscode.window.showWarningMessage('AAHP: Set aahp.rootFolderPath in settings first.')
        return
      }

      const repos = scanAllRepos(devRoot)
      if (repos.length === 0) {
        vscode.window.showInformationMessage('AAHP: No repos with ready tasks found.')
        return
      }

      const confirm = await vscode.window.showInformationMessage(
        `AAHP: Spawn ${repos.length} Claude agents in parallel?\n\n${repos.map(r => `• ${r.repoName} → [${r.taskId}] ${r.taskTitle}`).join('\n')}`,
        { modal: true },
        'Run All Agents'
      )
      if (confirm !== 'Run All Agents') return

      vscode.window.showInformationMessage(`🤖 AAHP: Spawning ${repos.length} agents - check Output channels per repo`)

      spawnAllAgents(repos, runs => {
        onAgentRuns?.(runs)
      }).then(finalRuns => {
        const done = finalRuns.filter(r => r.committed).length
        const failed = finalRuns.filter(r => r.status === 'failed').length
        vscode.window.showInformationMessage(
          `🤖 AAHP Agents done: ${done} committed, ${failed} failed, ${finalRuns.length - done - failed} partial`
        )
        reloadCtx()
      })
    }),
  ]
}

