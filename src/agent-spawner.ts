import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import { SessionMonitor, QueuedTask } from './session-monitor'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoTask {
  repoPath: string
  repoName: string
  manifestPath: string
  taskId: string
  taskTitle: string
  phase: string
  quickContext: string
  taskPriority: string
}

export type AgentStatus = 'queued' | 'running' | 'done' | 'failed'
export type AgentBackend = 'claude' | 'copilot'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AgentRun {
  repo: RepoTask
  status: AgentStatus
  backend: AgentBackend
  output: string
  committed: boolean
  tokens: TokenUsage
  startedAt?: Date
  finishedAt?: Date
}

/** Session-wide token accumulator - persists across multiple runAll calls */
export const sessionTokens: Record<AgentBackend, TokenUsage> = {
  claude: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  copilot: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
}

// ── Scanning ──────────────────────────────────────────────────────────────────

/** Scan root dev folder for all repos with AAHP manifests that have ready tasks */
export function scanAllRepos(rootDir: string): RepoTask[] {
  const results: RepoTask[] = []
  if (!fs.existsSync(rootDir)) return results

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const repoPath = path.join(rootDir, entry.name)
    const manifestPath = path.join(repoPath, '.ai', 'handoff', 'MANIFEST.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const tasks: Record<string, { status: string; title: string; priority?: string }> = manifest.tasks ?? {}
      const readyTask = Object.entries(tasks).find(([, t]) => t.status === 'ready' || t.status === 'in_progress')
      if (!readyTask) continue

      results.push({
        repoPath,
        repoName: entry.name,
        manifestPath,
        taskId: readyTask[0],
        taskTitle: readyTask[1].title,
        taskPriority: readyTask[1].priority ?? 'medium',
        phase: manifest.last_session?.phase ?? 'unknown',
        quickContext: manifest.quick_context ?? '',
      })
    } catch { /* skip malformed */ }
  }
  return results
}

// ── Load Balancer ─────────────────────────────────────────────────────────────

/**
 * Decide which backend to use for a task.
 * Config aahp.agentBackend:
 *   'auto'    → high priority = claude, medium/low = copilot
 *   'claude'  → always claude
 *   'copilot' → always copilot
 */
export function pickBackend(repo: RepoTask): AgentBackend {
  const config = vscode.workspace.getConfiguration('aahp')
  const setting = config.get<string>('agentBackend', 'auto')

  if (setting === 'claude') return 'claude'
  if (setting === 'copilot') return 'copilot'

  // auto: heavy/complex → claude, routine → copilot
  return repo.taskPriority === 'high' ? 'claude' : 'copilot'
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildAgentPrompt(repo: RepoTask): string {
  const manifest = JSON.parse(fs.readFileSync(repo.manifestPath, 'utf8'))
  const handoffDir = path.dirname(repo.manifestPath)
  const load = (name: string) => {
    try { return fs.readFileSync(path.join(handoffDir, name), 'utf8').slice(0, 2000) } catch { return '' }
  }
  const tasksList = Object.entries(manifest.tasks ?? {})
    .map(([id, t]: [string, any]) => `  [${id}] ${t.status.padEnd(12)} ${t.title} (${t.priority ?? 'medium'})`)
    .join('\n')

  return `# AAHP v3 Agent Task - ${repo.repoName}

## Project
${repo.quickContext}

## Phase: ${repo.phase}
## Active Task: [${repo.taskId}] ${repo.taskTitle}

## All Tasks
${tasksList}

## Conventions
${load('CONVENTIONS.md') || '(none)'}

## Trust State
${load('TRUST.md') || '(none)'}

---
Repository path: ${repo.repoPath}

Instructions:
1. Read relevant source files to understand the codebase
2. Implement [${repo.taskId}]: ${repo.taskTitle}
3. Run tests/builds to verify
4. If no GitHub issue exists for this task, create one with \`gh issue create\`
5. Commit all changes with a conventional commit message
6. Update .ai/handoff/MANIFEST.json: set tasks["${repo.taskId}"].status = "done" and tasks["${repo.taskId}"].completed = ISO timestamp now

Work autonomously. Do not ask for permission.`
}

// ── Claude Code backend ───────────────────────────────────────────────────────

async function runClaude(
  run: AgentRun,
  channel: vscode.OutputChannel,
  onUpdate: () => void
): Promise<void> {
  const prompt = buildAgentPrompt(run.repo)

  return new Promise<void>(resolve => {
    // C-3: Use explicit --allowedTools instead of --dangerously-skip-permissions
    const proc = spawn('claude', [
      '--print',
      '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep,WebFetch',
      '--output-format', 'json',
    ], { cwd: run.repo.repoPath, shell: true })

    proc.stdin.write(prompt)
    proc.stdin.end()

    let rawOutput = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      rawOutput += chunk.toString()
      // For streaming display, show as text even though final output will be JSON
      channel.append(chunk.toString())
      onUpdate()
    })

    proc.stderr.on('data', (chunk: Buffer) => channel.append(chunk.toString()))

    proc.on('close', (code) => {
      // B-1: Set failed status when process exits with non-zero code
      if (code !== 0) {
        run.status = 'failed'
      }

      // Parse JSON output for token counts
      try {
        // claude --output-format json may return multiple JSON objects (stream) or one
        const lines = rawOutput.trim().split('\n')
        // B-6: Use slice().reverse() to avoid mutating the original array
        const lastJson = lines.slice().reverse().find(l => l.startsWith('{'))
        if (lastJson) {
          const parsed = JSON.parse(lastJson)
          const usage = parsed.usage ?? parsed.result?.usage ?? {}
          run.tokens = {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          }
          // Extract plain text from JSON result if available
          run.output = parsed.result ?? parsed.content?.[0]?.text ?? rawOutput
        } else {
          run.output = rawOutput
        }
      } catch {
        run.output = rawOutput
      }

      // Accumulate session tokens
      sessionTokens.claude.inputTokens += run.tokens.inputTokens
      sessionTokens.claude.outputTokens += run.tokens.outputTokens
      sessionTokens.claude.totalTokens += run.tokens.totalTokens

      // B-5: Check for recent commits using git log instead of fragile string matching
      try {
        const gitCheck = spawnSync('git', ['log', '--oneline', '-1', '--since=5 minutes ago'], {
          cwd: run.repo.repoPath, shell: false, encoding: 'utf8', timeout: 10000,
        })
        run.committed = (gitCheck.stdout?.trim().length ?? 0) > 0
      } catch {
        // Fallback to string matching if git log fails
        run.committed = run.output.toLowerCase().includes('committed') ||
          run.output.toLowerCase().includes('[main ')
      }

      channel.appendLine(`\nTokens - in:${run.tokens.inputTokens} out:${run.tokens.outputTokens} total:${run.tokens.totalTokens}`)
      resolve()
    })

    proc.on('error', err => {
      run.output = `Claude CLI error: ${err.message}`
      channel.appendLine(`❌ ${run.output}`)
      resolve()
    })
  })
}

// ── GitHub Copilot backend ────────────────────────────────────────────────────

const COPILOT_TOOLS: vscode.LanguageModelChatTool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the repository',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path from repo root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files in a directory',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path, or "." for root' } },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the repo directory (build, test, git)',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
]

/** Allowlist of command prefixes for the run_command tool (C-2) */
const ALLOWED_COMMAND_PREFIXES = [
  'git', 'npm', 'pnpm', 'node', 'npx', 'tsc', 'vitest', 'jest',
  'echo', 'ls', 'dir', 'cat', 'type', 'pwd', 'cd',
]

function executeCopilotTool(name: string, input: Record<string, string>, repoPath: string, channel: vscode.OutputChannel): string {
  /** Resolve a relative path and verify it stays within the repo (C-4) */
  const safePath = (p: string): string => {
    const resolved = path.resolve(repoPath, p.replace(/^\//, ''))
    const normalizedRepo = path.resolve(repoPath)
    if (resolved !== normalizedRepo && !resolved.startsWith(normalizedRepo + path.sep)) {
      throw new Error('path outside repo')
    }
    return resolved
  }

  try {
    switch (name) {
      case 'read_file': {
        const fp = safePath(input['path'] ?? '')
        return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').slice(0, 8000) : 'ERROR: file not found'
      }
      case 'write_file': {
        const fp = safePath(input['path'] ?? '')
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, input['content'] ?? '', 'utf8')
        return `OK: wrote ${fp}`
      }
      case 'list_dir': {
        const dp = safePath(input['path'] ?? '.')  // C-5: path traversal check via safePath
        return fs.existsSync(dp)
          ? fs.readdirSync(dp, { withFileTypes: true }).map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n')
          : 'ERROR: directory not found'
      }
      case 'run_command': {
        // C-2: Strict allowlist approach - only permit known-safe command prefixes
        const cmd = input['command'] ?? ''
        const parts = cmd.trim().split(/\s+/)
        const executable = parts[0] ?? ''
        if (!ALLOWED_COMMAND_PREFIXES.includes(executable.toLowerCase())) {
          return `ERROR: command '${executable}' not in allowlist. Allowed: ${ALLOWED_COMMAND_PREFIXES.join(', ')}`
        }
        // Use spawnSync with shell: false to avoid shell injection
        const args = parts.slice(1)
        const result = spawnSync(executable, args, { cwd: repoPath, shell: false, encoding: 'utf8', timeout: 60000 })
        return (result.stdout + result.stderr).slice(0, 4000) || `exit ${result.status}`
      }
      default: return `ERROR: unknown tool ${name}`
    }
  } catch (err) {
    return `ERROR: ${String(err)}`
  }
}

async function runCopilot(
  run: AgentRun,
  channel: vscode.OutputChannel,
  onUpdate: () => void
): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' })
  const model = models[0] ?? (await vscode.lm.selectChatModels())[0]

  if (!model) {
    run.output = 'ERROR: No Copilot model available. Make sure GitHub Copilot Chat is installed and signed in.'
    channel.appendLine(run.output)
    return
  }

  channel.appendLine(`Copilot model: ${model.name} (${model.id})`)

  const prompt = buildAgentPrompt(run.repo)
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(prompt),
  ]

  const MAX_TURNS = 20
  let turns = 0

  // B-4: Create a single CancellationTokenSource outside the loop to avoid leaks
  const cts = new vscode.CancellationTokenSource()

  while (turns < MAX_TURNS) {
    turns++
    channel.appendLine(`\n-- Turn ${turns}/${MAX_TURNS} --`)

    let response: vscode.LanguageModelChatResponse

    try {
      response = await model.sendRequest(messages, { tools: COPILOT_TOOLS }, cts.token)
    } catch (err) {
      channel.appendLine(`Copilot error: ${String(err)}`)
      break
    }

    // Collect full response
    let textContent = ''
    const toolCalls: vscode.LanguageModelToolCallPart[] = []

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textContent += part.value
        channel.append(part.value)
        run.output += part.value
        onUpdate()
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push(part)
      }
    }

    // Token counting (available in newer VS Code builds)
    const usage = (response as any).usage
    if (usage) {
      run.tokens.inputTokens += usage.inputTokens ?? usage.prompt_tokens ?? 0
      run.tokens.outputTokens += usage.outputTokens ?? usage.completion_tokens ?? 0
      run.tokens.totalTokens = run.tokens.inputTokens + run.tokens.outputTokens
    }

    if (toolCalls.length === 0) {
      // No tools called - agent is done
      channel.appendLine('\nCopilot agent finished.')
      break
    }

    // Execute tools and feed results back
    const assistantMsg = vscode.LanguageModelChatMessage.Assistant('')
    ;(assistantMsg as any).content = [
      ...(textContent ? [new vscode.LanguageModelTextPart(textContent)] : []),
      ...toolCalls,
    ]
    messages.push(assistantMsg)

    const toolResults: vscode.LanguageModelToolResultPart[] = []
    for (const call of toolCalls) {
      const input = call.input as Record<string, string>
      channel.appendLine(`\nTool: ${call.name}(${JSON.stringify(input).slice(0, 80)})`)
      const result = executeCopilotTool(call.name, input, run.repo.repoPath, channel)
      channel.appendLine(`   -> ${result.slice(0, 120)}`)

      if (call.name === 'run_command' && result.toLowerCase().includes('committed')) {
        run.committed = true
      }
      toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(result)]))
    }

    messages.push(vscode.LanguageModelChatMessage.User(''))
    ;(messages[messages.length - 1] as any).content = toolResults
  }

  // B-4: Dispose the CancellationTokenSource when done
  cts.dispose()

  // Accumulate session tokens
  sessionTokens.copilot.inputTokens += run.tokens.inputTokens
  sessionTokens.copilot.outputTokens += run.tokens.outputTokens
  sessionTokens.copilot.totalTokens += run.tokens.totalTokens

  // B-5: Check for recent commits using git log instead of fragile string matching
  try {
    const gitCheck = spawnSync('git', ['log', '--oneline', '-1', '--since=5 minutes ago'], {
      cwd: run.repo.repoPath, shell: false, encoding: 'utf8', timeout: 10000,
    })
    run.committed = run.committed || (gitCheck.stdout?.trim().length ?? 0) > 0
  } catch {
    // Fallback to string matching if git log fails
    run.committed = run.committed ||
      run.output.toLowerCase().includes('committed') ||
      run.output.toLowerCase().includes('[main ')
  }

  channel.appendLine(`\nTokens - in:${run.tokens.inputTokens} out:${run.tokens.outputTokens} total:${run.tokens.totalTokens}`)
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/** Spawn one agent per repo, all in parallel. Auto-selects Claude or Copilot per task.
 *  If a repo already has an active session (tracked via SessionMonitor), the task is
 *  queued instead of spawned — so ongoing work is never interrupted.
 */
export async function spawnAllAgents(
  repos: RepoTask[],
  onUpdate: (runs: AgentRun[]) => void,
  monitor?: SessionMonitor,
  maxConcurrent = 0
): Promise<AgentRun[]> {
  // B-7: Reset session token counters at the start of each orchestration run
  sessionTokens.claude = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  sessionTokens.copilot = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  // Separate repos into: spawn now vs queue (already has an active session)
  const toSpawn: RepoTask[] = []
  const toQueue: RepoTask[] = []

  for (const repo of repos) {
    if (monitor?.isRepoActive(repo.repoPath)) {
      toQueue.push(repo)
    } else {
      toSpawn.push(repo)
    }
  }

  // Enqueue tasks for repos that are already busy
  for (const repo of toQueue) {
    await monitor?.enqueue({
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      taskId: repo.taskId,
      taskTitle: repo.taskTitle,
      queuedAt: new Date().toISOString(),
    })
    vscode.window.showInformationMessage(
      `AAHP: ${repo.repoName} is already active — task [${repo.taskId}] queued.`
    )
  }

  if (toSpawn.length === 0) {
    vscode.window.showInformationMessage('AAHP: All selected repos are currently active. Tasks have been queued.')
    return []
  }

  const runs: AgentRun[] = toSpawn.map(repo => ({
    repo,
    status: 'queued' as AgentStatus,
    backend: pickBackend(repo),
    output: '',
    committed: false,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }))

  // B-2: Extract async body into a proper async function instead of new Promise(async resolve)
  async function runSingleAgent(run: AgentRun): Promise<void> {
    const backendLabel = run.backend === 'claude' ? 'Claude Code' : 'GitHub Copilot'
    const channel = vscode.window.createOutputChannel(`AAHP [${run.backend === 'claude' ? 'CL' : 'CP'} ${run.repo.repoName}]`)

    run.status = 'running'
    run.startedAt = new Date()
    onUpdate([...runs])

    // Register with monitor so other spawns know this repo is busy
    await monitor?.registerSession({
      repoPath: run.repo.repoPath,
      repoName: run.repo.repoName,
      taskId: run.repo.taskId,
      taskTitle: run.repo.taskTitle,
      backend: run.backend,
      startedAt: run.startedAt.toISOString(),
    })

    channel.appendLine(`AAHP Agent - ${run.repo.repoName}`)
    channel.appendLine(`Backend: ${backendLabel} (priority: ${run.repo.taskPriority})`)
    channel.appendLine(`Task: [${run.repo.taskId}] ${run.repo.taskTitle}`)
    channel.appendLine('-'.repeat(60))
    channel.show(true)

    try {
      if (run.backend === 'claude') {
        await runClaude(run, channel, () => onUpdate([...runs]))
      } else {
        await runCopilot(run, channel, () => onUpdate([...runs]))
      }

      run.finishedAt = new Date()
      run.status = run.committed ? 'done' : 'failed'

      if (run.committed) {
        markManifestDone(run.repo, run.backend)
      }

      channel.appendLine('-'.repeat(60))
      channel.appendLine(run.committed
        ? `[${run.repo.taskId}] completed - committed via ${backendLabel}`
        : `Agent finished - review output (no commit detected)`
      )
    } catch (err) {
      run.status = 'failed'
      run.finishedAt = new Date()
      channel.appendLine(`Agent error: ${String(err)}`)
    }

    // Deregister session and drain queue for this repo
    await monitor?.deregisterSession(run.repo.repoPath)
    await monitor?.drainQueue(run.repo.repoPath, async (queued: QueuedTask) => {
      const queuedRepo: RepoTask = {
        repoPath: queued.repoPath,
        repoName: queued.repoName,
        manifestPath: path.join(queued.repoPath, '.ai', 'handoff', 'MANIFEST.json'),
        taskId: queued.taskId,
        taskTitle: queued.taskTitle,
        taskPriority: 'medium',
        phase: 'queued',
        quickContext: '',
      }
      await spawnAllAgents([queuedRepo], onUpdate, monitor, maxConcurrent)
    })

    onUpdate([...runs])
  }

  await runWithConcurrencyLimit(runs, maxConcurrent, runSingleAgent)
  return runs
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

/**
 * Sliding-window semaphore. maxConcurrent=0 means unlimited (all in parallel).
 * Example: 9 repos, maxConcurrent=3 → first 3 start immediately, each new slot
 * opens as soon as one finishes — never more than 3 running at the same time.
 */
async function runWithConcurrencyLimit(
  runs: AgentRun[],
  maxConcurrent: number,
  runFn: (run: AgentRun) => Promise<void>
): Promise<void> {
  if (maxConcurrent <= 0 || maxConcurrent >= runs.length) {
    await Promise.all(runs.map(runFn))
    return
  }

  const queue = [...runs]
  let active = 0

  await new Promise<void>((resolve, reject) => {
    const next = () => {
      if (queue.length === 0 && active === 0) { resolve(); return }
      while (active < maxConcurrent && queue.length > 0) {
        const run = queue.shift()!
        active++
        runFn(run).then(() => { active--; next() }).catch(() => { active--; next() })
      }
    }
    next()
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function markManifestDone(repo: RepoTask, backend: AgentBackend) {
  try {
    const manifest = JSON.parse(fs.readFileSync(repo.manifestPath, 'utf8'))
    if (manifest.tasks?.[repo.taskId]) {
      manifest.tasks[repo.taskId].status = 'done'
      manifest.tasks[repo.taskId].completed = new Date().toISOString()
    }
    manifest.last_session = {
      ...manifest.last_session,
      agent: backend === 'claude' ? 'claude-code' : 'github-copilot',
      timestamp: new Date().toISOString(),
    }
    fs.writeFileSync(repo.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  } catch { /* best-effort */ }
}

/** Get root dev folder from VS Code config or workspace */
export function getDevRoot(): string {
  const config = vscode.workspace.getConfiguration('aahp')
  const explicit = config.get<string>('rootFolderPath')
  if (explicit) return explicit
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
}
