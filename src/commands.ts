import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import {
  AahpContext,
  loadAahpContextByPath,
  refreshManifestChecksums,
  saveManifest,
  getWorkspaceRoot,
  parseNextActions,
} from './aahp-reader'
import { scanAllRepos, spawnAllAgents, retryFailedAgent, getDevRoot, AgentRun } from './agent-spawner'
import { SessionMonitor } from './session-monitor'
import { AahpDashboardProvider } from './sidebar'
import { FlatTask } from './task-tree'
const PHASES = ['research', 'architecture', 'implementation', 'review', 'fix', 'release']

export function registerCommands(
  context: vscode.ExtensionContext,
  getCtx: () => AahpContext | undefined,
  reloadCtx: () => void,
  onAgentRuns?: (runs: AgentRun[]) => void,
  monitor?: SessionMonitor,
  dashboardProvider?: AahpDashboardProvider
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
      }, monitor, limit).then(finalRuns => {
        const done = finalRuns.filter(r => r.committed).length
        const failed = finalRuns.filter(r => r.status === 'failed').length
        vscode.window.showInformationMessage(
          `🤖 AAHP Agents done: ${done} committed, ${failed} failed, ${finalRuns.length - done - failed} partial`
        )
        reloadCtx()
      })
    }),

    // ── Focus Repo in Dashboard ────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.focusRepo', (repoPath: string) => {
      if (!repoPath || !dashboardProvider) return
      const handoffDir = path.join(repoPath, '.ai', 'handoff')
      const ctx = loadAahpContextByPath(handoffDir)
      dashboardProvider.updateFocusedRepo(repoPath, ctx)
    }),

    // ── Run Single Repo Agent ──────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.runSingleRepo', async (repoPath: string) => {
      const devRoot = getDevRoot()
      if (!devRoot) { vscode.window.showWarningMessage('AAHP: No root path configured.'); return }
      if (!repoPath) { vscode.window.showWarningMessage('AAHP: No repo selected.'); return }

      const repos = scanAllRepos(devRoot).filter(r => r.repoPath === repoPath)
      if (repos.length === 0) {
        vscode.window.showWarningMessage('AAHP: No ready tasks in this repo.')
        return
      }

      const repo = repos[0]!
      const confirm = await vscode.window.showInformationMessage(
        `AAHP: Spawn agent for ${repo.repoName} - [${repo.taskId}] ${repo.taskTitle}?`,
        { modal: true },
        'Run Agent'
      )
      if (confirm !== 'Run Agent') return

      vscode.window.showInformationMessage(`AAHP: Spawning agent for ${repo.repoName}...`)

      spawnAllAgents([repo], runs => {
        onAgentRuns?.(runs)
      }, monitor, 1).then(finalRuns => {
        const r = finalRuns[0]
        if (r) {
          vscode.window.showInformationMessage(
            r.committed
              ? `AAHP: ${repo.repoName} [${repo.taskId}] committed.`
              : `AAHP: ${repo.repoName} agent finished - review output.`
          )
        }
        reloadCtx()
      })
    }),

    // ── Set Task Status ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.setTaskStatus', async (
      repoPath: string,
      taskId: string,
      newStatus: string
    ) => {
      if (!repoPath || !taskId || !newStatus) return
      const manifestPath = path.join(repoPath, '.ai', 'handoff', 'MANIFEST.json')

      try {
        const raw = fs.readFileSync(manifestPath, 'utf8')
        const manifest = JSON.parse(raw)
        if (manifest.tasks?.[taskId]) {
          manifest.tasks[taskId].status = newStatus
          if (newStatus === 'done') {
            manifest.tasks[taskId].completed = new Date().toISOString()
          }
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
          reloadCtx()
          vscode.window.showInformationMessage(`AAHP: ${taskId} -> ${newStatus}`)
        }
      } catch (err) {
        vscode.window.showWarningMessage(`AAHP: Failed to update task - ${String(err)}`)
      }
    }),

    // ── Retry Failed Agent ─────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.retryAgent', async (repoPath: string, taskId: string) => {
      if (!repoPath || !taskId) {
        vscode.window.showWarningMessage('AAHP: No repo/task specified for retry.')
        return
      }

      const devRoot = getDevRoot()
      if (!devRoot) {
        vscode.window.showWarningMessage('AAHP: No root path configured.')
        return
      }

      const repos = scanAllRepos(devRoot).filter(r => r.repoPath === repoPath)
      const repo = repos.find(r => r.taskId === taskId)
        ?? repos[0]

      if (!repo) {
        // Build a minimal RepoTask from the manifest if scanAllRepos does not return it
        const manifestPath = path.join(repoPath, '.ai', 'handoff', 'MANIFEST.json')
        if (!fs.existsSync(manifestPath)) {
          vscode.window.showWarningMessage('AAHP: No manifest found for retry.')
          return
        }
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          const task = manifest.tasks?.[taskId]
          if (!task) {
            vscode.window.showWarningMessage(`AAHP: Task ${taskId} not found in manifest.`)
            return
          }
          const fallbackRepo = {
            repoPath,
            repoName: path.basename(repoPath),
            manifestPath,
            taskId,
            taskTitle: task.title,
            taskPriority: task.priority ?? 'medium',
            phase: manifest.last_session?.phase ?? 'unknown',
            quickContext: manifest.quick_context ?? '',
          }
          vscode.window.showInformationMessage(`AAHP: Retrying [${taskId}] for ${fallbackRepo.repoName}...`)
          retryFailedAgent(fallbackRepo, runs => { onAgentRuns?.(runs) }, monitor).then(finalRuns => {
            const r = finalRuns[0]
            if (r?.committed) {
              vscode.window.showInformationMessage(`AAHP: Retry succeeded - [${taskId}] committed.`)
            } else {
              vscode.window.showInformationMessage(`AAHP: Retry finished - review output.`)
            }
            reloadCtx()
          })
          return
        } catch (err) {
          vscode.window.showWarningMessage(`AAHP: Failed to read manifest for retry - ${String(err)}`)
          return
        }
      }

      vscode.window.showInformationMessage(`AAHP: Retrying [${repo.taskId}] for ${repo.repoName}...`)
      retryFailedAgent(repo, runs => { onAgentRuns?.(runs) }, monitor).then(finalRuns => {
        const r = finalRuns[0]
        if (r?.committed) {
          vscode.window.showInformationMessage(`AAHP: Retry succeeded - [${repo.taskId}] committed.`)
        } else {
          vscode.window.showInformationMessage(`AAHP: Retry finished - review output.`)
        }
        reloadCtx()
      })
    }),

    // ── Fix Task (spawn agent for a specific task) ───────────────────────────
    vscode.commands.registerCommand('aahp.fixTask', async (repoPath: string, taskId: string) => {
      if (!repoPath || !taskId) {
        vscode.window.showWarningMessage('AAHP: No repo/task specified.')
        return
      }

      const manifestPath = path.join(repoPath, '.ai', 'handoff', 'MANIFEST.json')
      if (!fs.existsSync(manifestPath)) {
        vscode.window.showWarningMessage('AAHP: No manifest found for this repo.')
        return
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const task = manifest.tasks?.[taskId]
        if (!task) {
          vscode.window.showWarningMessage(`AAHP: Task ${taskId} not found in manifest.`)
          return
        }

        const repoName = path.basename(repoPath)

        // Check for unresolved dependencies
        const deps: string[] = task.depends_on ?? []
        const unresolvedDeps: string[] = []
        for (const depId of deps) {
          const depTask = manifest.tasks?.[depId]
          if (depTask && depTask.status !== 'done') {
            unresolvedDeps.push(`${depId}: ${depTask.title} (${depTask.status})`)
          }
        }

        let confirmMsg = `AAHP: Run agent to fix [${taskId}] "${task.title}" in ${repoName}?`
        const buttons: string[] = ['Run Agent']
        if (unresolvedDeps.length > 0) {
          confirmMsg = `AAHP: [${taskId}] has unresolved dependencies:\n\n${unresolvedDeps.join('\n')}\n\nRun anyway?`
          buttons.push('Cancel')
        }

        const confirm = await vscode.window.showInformationMessage(
          confirmMsg,
          { modal: true },
          ...buttons
        )
        if (confirm !== 'Run Agent') return

        const repo = {
          repoPath,
          repoName,
          manifestPath,
          taskId,
          taskTitle: task.title,
          taskPriority: task.priority ?? 'medium',
          phase: manifest.last_session?.phase ?? 'unknown',
          quickContext: manifest.quick_context ?? '',
        }

        vscode.window.showInformationMessage(`AAHP: Spawning agent for ${repoName} [${taskId}]...`)

        spawnAllAgents([repo], runs => { onAgentRuns?.(runs) }, monitor, 1).then(finalRuns => {
          const r = finalRuns[0]
          if (r?.committed) {
            vscode.window.showInformationMessage(`AAHP: ${repoName} [${taskId}] committed.`)
          } else {
            vscode.window.showInformationMessage(`AAHP: ${repoName} [${taskId}] agent finished - review output.`)
          }
          reloadCtx()
        })
      } catch (err) {
        vscode.window.showWarningMessage(`AAHP: Failed to read manifest - ${String(err)}`)
      }
    }),

    // ── Launch Task from Tree View (inline play button) ─────────────────────
    vscode.commands.registerCommand('aahp.launchTask', async (element: FlatTask) => {
      if (!element?.repoPath || !element?.taskId) {
        vscode.window.showWarningMessage('AAHP: No task selected.')
        return
      }
      const { repoPath, repoName, taskId, task } = element

      const manifestPath = path.join(repoPath, '.ai', 'handoff', 'MANIFEST.json')
      if (!fs.existsSync(manifestPath)) {
        vscode.window.showWarningMessage('AAHP: No manifest found for this repo.')
        return
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

        // Check for unresolved dependencies
        const deps: string[] = task.depends_on ?? []
        const unresolvedDeps: string[] = []
        for (const depId of deps) {
          const depTask = manifest.tasks?.[depId]
          if (depTask && depTask.status !== 'done') {
            unresolvedDeps.push(`[${depId}] ${depTask.title} (${depTask.status})`)
          }
        }

        if (unresolvedDeps.length > 0) {
          const choice = await vscode.window.showWarningMessage(
            `Task [${taskId}] has unresolved dependencies:\n\n${unresolvedDeps.join('\n')}\n\nThese should be completed first.`,
            { modal: true },
            'Run Anyway',
            'Cancel'
          )
          if (choice !== 'Run Anyway') return
        } else {
          const confirm = await vscode.window.showInformationMessage(
            `Launch agent for [${taskId}] "${task.title}" in ${repoName}?`,
            { modal: true },
            'Run Agent'
          )
          if (confirm !== 'Run Agent') return
        }

        // Build enhanced prompt with NEXT_ACTIONS.md task detail
        let taskDetail = ''
        const nextActionsPath = path.join(repoPath, '.ai', 'handoff', 'NEXT_ACTIONS.md')
        if (fs.existsSync(nextActionsPath)) {
          const nextActionsMd = fs.readFileSync(nextActionsPath, 'utf8')
          // Extract the section for this task ID
          const taskSectionRegex = new RegExp(
            `### ${taskId.replace(/[-]/g, '\\$&')}[:\\s].*?(?=\\n### T-\\d|\\n---\\n|\\n## |$)`,
            's'
          )
          const match = nextActionsMd.match(taskSectionRegex)
          if (match) {
            taskDetail = match[0].trim()
          }
        }

        const repo = {
          repoPath,
          repoName,
          manifestPath,
          taskId,
          taskTitle: task.title,
          taskPriority: task.priority ?? 'medium',
          phase: manifest.last_session?.phase ?? 'unknown',
          quickContext: manifest.quick_context ?? '',
          ...(taskDetail ? { taskDetail } : {}),
        }

        vscode.window.showInformationMessage(`AAHP: Spawning agent for ${repoName} [${taskId}]...`)

        spawnAllAgents([repo], runs => { onAgentRuns?.(runs) }, monitor, 1).then(finalRuns => {
          const r = finalRuns[0]
          if (r?.committed) {
            vscode.window.showInformationMessage(`AAHP: ${repoName} [${taskId}] committed.`)
          } else {
            vscode.window.showInformationMessage(`AAHP: ${repoName} [${taskId}] agent finished - review output.`)
          }
          reloadCtx()
        })
      } catch (err) {
        vscode.window.showWarningMessage(`AAHP: Failed to launch task - ${String(err)}`)
      }
    }),

    // ── Open Task on GitHub (tree view inline button) ──────────────────────
    vscode.commands.registerCommand('aahp.openTaskOnGitHub', async (element: FlatTask) => {
      if (!element?.repoPath || !element?.taskId) return

      // Detect GitHub URL from git config
      const gitConfigPath = path.join(element.repoPath, '.git', 'config')
      let ghUrl: string | undefined
      try {
        const content = fs.readFileSync(gitConfigPath, 'utf8')
        const sshMatch = content.match(/url\s*=\s*git@github\.com:(.+?)(?:\.git)?$/m)
        if (sshMatch?.[1]) ghUrl = `https://github.com/${sshMatch[1]}`
        else {
          const httpsMatch = content.match(/url\s*=\s*(https:\/\/github\.com\/[^/]+\/[^/]+?)(?:\.git)?$/m)
          if (httpsMatch?.[1]) ghUrl = httpsMatch[1]
        }
      } catch { /* ignore */ }

      if (!ghUrl) {
        vscode.window.showWarningMessage('AAHP: No GitHub remote found for this repo.')
        return
      }

      const issueUrl = `${ghUrl}/issues?q=${encodeURIComponent(element.taskId)}`
      vscode.env.openExternal(vscode.Uri.parse(issueUrl))
    }),

    // ── Refresh All (re-scan repos and NEXT_ACTIONS.md) ───────────────────────
    vscode.commands.registerCommand('aahp.refreshAll', () => {
      reloadCtx()
      vscode.window.showInformationMessage('AAHP: Dashboard refreshed')
    }),

    // ── Create Task ──────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aahp.createTask', async (repoPath?: string) => {
      // Determine which repo to create the task in
      const targetPath = repoPath
        || dashboardProvider?.getFocusedRepoPath()
        || getWorkspaceRoot()
      if (!targetPath) {
        vscode.window.showWarningMessage('AAHP: No repo selected.')
        return
      }

      const manifestPath = path.join(targetPath, '.ai', 'handoff', 'MANIFEST.json')
      if (!fs.existsSync(manifestPath)) {
        vscode.window.showWarningMessage('AAHP: No MANIFEST.json found in this repo.')
        return
      }

      // Prompt for task title
      const title = await vscode.window.showInputBox({
        title: 'AAHP: New Task',
        prompt: 'Task title',
        placeHolder: 'e.g. Add retry logic for agent failures',
        validateInput: v => v.trim().length === 0 ? 'Title is required' : undefined,
      })
      if (!title) return

      // Prompt for priority
      const priority = await vscode.window.showQuickPick(
        ['high', 'medium', 'low'],
        { title: 'AAHP: Task Priority', placeHolder: 'Select priority' }
      )
      if (!priority) return

      // Prompt for dependencies (optional)
      const depsInput = await vscode.window.showInputBox({
        title: 'AAHP: Dependencies',
        prompt: 'Task IDs this depends on (comma-separated, leave empty for none)',
        placeHolder: 'e.g. T-003, T-005',
      })
      if (depsInput === undefined) return // user cancelled

      const dependsOn = depsInput.trim()
        ? depsInput.split(',').map(s => s.trim()).filter(Boolean)
        : []

      try {
        const raw = fs.readFileSync(manifestPath, 'utf8')
        const manifest = JSON.parse(raw)
        if (!manifest.tasks) manifest.tasks = {}
        const nextId = manifest.next_task_id ?? Object.keys(manifest.tasks).length + 1
        const taskId = `T-${String(nextId).padStart(3, '0')}`

        manifest.tasks[taskId] = {
          title: title.trim(),
          status: dependsOn.length > 0 ? 'blocked' : 'ready',
          priority,
          depends_on: dependsOn,
          created: new Date().toISOString(),
        }
        manifest.next_task_id = nextId + 1

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
        reloadCtx()
        vscode.window.showInformationMessage(`AAHP: Created ${taskId} - ${title.trim()}`)
      } catch (err) {
        vscode.window.showWarningMessage(`AAHP: Failed to create task - ${String(err)}`)
      }
    }),
  ]
}

