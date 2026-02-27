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

      // B-3: Use single quotes with proper escaping to prevent shell injection via backticks/$()
      const safeMsg = msg.replace(/'/g, "'\\''")
      const terminal = vscode.window.createTerminal({ name: 'AAHP Commit', cwd: root })
      terminal.sendText(`git add .ai/handoff/ && git commit -m '${safeMsg}' -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'`)
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

      const config = vscode.workspace.getConfiguration('aahp')
      const limit: number = config.get('agentConcurrencyLimit', 0)
      const limitLabel = limit > 0 ? `, max ${limit} at a time` : ', all in parallel'

      const confirm = await vscode.window.showInformationMessage(
        `AAHP: Spawn ${repos.length} agents${limitLabel}?\n\n${repos.map(r => `• ${r.repoName} → [${r.taskId}] ${r.taskTitle}`).join('\n')}`,
        { modal: true },
        'Run All Agents',
        'Change Limit…'
      )

      if (confirm === 'Change Limit…') {
        const entered = await vscode.window.showInputBox({
          title: 'AAHP: Agent Concurrency Limit',
          prompt: 'Max agents to run in parallel (0 = unlimited)',
          value: String(limit),
          placeHolder: '0',
          validateInput: v => isNaN(Number(v)) || Number(v) < 0 ? 'Enter a number ≥ 0' : undefined,
        })
        if (entered === undefined) return
        const newLimit = parseInt(entered, 10) || 0
        await config.update('agentConcurrencyLimit', newLimit, vscode.ConfigurationTarget.Workspace)
        // Re-run with new limit
        vscode.commands.executeCommand('aahp.runAll')
        return
      }

      if (confirm !== 'Run All Agents') return

      const limitMsg = limit > 0 ? ` (${limit} at a time)` : ''
      vscode.window.showInformationMessage(`🤖 AAHP: Spawning ${repos.length} agents${limitMsg} — check Output channels per repo`)

      spawnAllAgents(repos, runs => {
        onAgentRuns?.(runs)
      }, undefined, limit).then(finalRuns => {
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

