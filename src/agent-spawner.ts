import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'

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
    const proc = spawn('claude', [
      '--print',
      '--dangerously-skip-permissions',
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

    proc.on('close', () => {
      // Parse JSON output for token counts
      try {
        // claude --output-format json may return multiple JSON objects (stream) or one
        const lines = rawOutput.trim().split('\n')
        const lastJson = lines.reverse().find(l => l.startsWith('{'))
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

      run.committed = run.output.toLowerCase().includes('committed') ||
        run.output.toLowerCase().includes('[main ') ||
        run.output.toLowerCase().includes('git commit')

      channel.appendLine(`\n📊 Tokens - in:${run.tokens.inputTokens} out:${run.tokens.outputTokens} total:${run.tokens.totalTokens}`)
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

function executeCopilotTool(name: string, input: Record<string, string>, repoPath: string, channel: vscode.OutputChannel): string {
  const safePath = (p: string) => path.resolve(repoPath, p.replace(/^\//, ''))

  try {
    switch (name) {
      case 'read_file': {
        const fp = safePath(input['path'] ?? '')
        if (!fp.startsWith(repoPath)) return 'ERROR: path outside repo'
        return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').slice(0, 8000) : 'ERROR: file not found'
      }
      case 'write_file': {
        const fp = safePath(input['path'] ?? '')
        if (!fp.startsWith(repoPath)) return 'ERROR: path outside repo'
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, input['content'] ?? '', 'utf8')
        return `OK: wrote ${fp}`
      }
      case 'list_dir': {
        const dp = safePath(input['path'] ?? '.')
        return fs.existsSync(dp)
          ? fs.readdirSync(dp, { withFileTypes: true }).map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n')
          : 'ERROR: directory not found'
      }
      case 'run_command': {
        const cmd = input['command'] ?? ''
        // Safety: block destructive commands
        if (/rm\s+-rf\s+\/|format|del\s+\/f\s+\/s/i.test(cmd)) return 'ERROR: command blocked'
        const result = spawnSync(cmd, { cwd: repoPath, shell: true, encoding: 'utf8', timeout: 60000 })
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
    channel.appendLine(`❌ ${run.output}`)
    return
  }

  channel.appendLine(`🤖 Copilot model: ${model.name} (${model.id})`)

  const prompt = buildAgentPrompt(run.repo)
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(prompt),
  ]

  const MAX_TURNS = 20
  let turns = 0

  while (turns < MAX_TURNS) {
    turns++
    channel.appendLine(`\n── Turn ${turns}/${MAX_TURNS} ──`)

    const token = new vscode.CancellationTokenSource().token
    let response: vscode.LanguageModelChatResponse

    try {
      response = await model.sendRequest(messages, { tools: COPILOT_TOOLS }, token)
    } catch (err) {
      channel.appendLine(`❌ Copilot error: ${String(err)}`)
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
      channel.appendLine('\n✅ Copilot agent finished.')
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
      channel.appendLine(`\n🔧 Tool: ${call.name}(${JSON.stringify(input).slice(0, 80)})`)
      const result = executeCopilotTool(call.name, input, run.repo.repoPath, channel)
      channel.appendLine(`   → ${result.slice(0, 120)}`)

      if (call.name === 'run_command' && result.toLowerCase().includes('committed')) {
        run.committed = true
      }
      toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(result)]))
    }

    messages.push(vscode.LanguageModelChatMessage.User(''))
    ;(messages[messages.length - 1] as any).content = toolResults
  }

  // Accumulate session tokens
  sessionTokens.copilot.inputTokens += run.tokens.inputTokens
  sessionTokens.copilot.outputTokens += run.tokens.outputTokens
  sessionTokens.copilot.totalTokens += run.tokens.totalTokens

  // Detect commit from output
  run.committed = run.committed ||
    run.output.toLowerCase().includes('committed') ||
    run.output.toLowerCase().includes('[main ')

  channel.appendLine(`\n📊 Tokens - in:${run.tokens.inputTokens} out:${run.tokens.outputTokens} total:${run.tokens.totalTokens}`)
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/** Spawn one agent per repo, all in parallel. Auto-selects Claude or Copilot per task. */
export async function spawnAllAgents(
  repos: RepoTask[],
  onUpdate: (runs: AgentRun[]) => void
): Promise<AgentRun[]> {
  const runs: AgentRun[] = repos.map(repo => ({
    repo,
    status: 'queued' as AgentStatus,
    backend: pickBackend(repo),
    output: '',
    committed: false,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }))

  const promises = runs.map((run, _i) => new Promise<void>(async resolve => {
    const backendLabel = run.backend === 'claude' ? 'Claude Code' : 'GitHub Copilot'
    const channel = vscode.window.createOutputChannel(`AAHP [${run.backend === 'claude' ? '⚡' : '🤖'}${run.repo.repoName}]`)

    run.status = 'running'
    run.startedAt = new Date()
    onUpdate([...runs])

    channel.appendLine(`🤖 AAHP Agent - ${run.repo.repoName}`)
    channel.appendLine(`Backend: ${backendLabel} (priority: ${run.repo.taskPriority})`)
    channel.appendLine(`Task: [${run.repo.taskId}] ${run.repo.taskTitle}`)
    channel.appendLine('─'.repeat(60))
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

      channel.appendLine('─'.repeat(60))
      channel.appendLine(run.committed
        ? `✅ [${run.repo.taskId}] completed - committed via ${backendLabel}`
        : `⚠️  Agent finished - review output (no commit detected)`
      )
    } catch (err) {
      run.status = 'failed'
      run.finishedAt = new Date()
      channel.appendLine(`❌ Agent error: ${String(err)}`)
    }

    onUpdate([...runs])
    resolve()
  }))

  await Promise.all(promises)
  return runs
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
