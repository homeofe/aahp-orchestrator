import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// ── AAHP v3 types ────────────────────────────────────────────────────────────

export interface AahpFileEntry {
  checksum: string
  updated: string
  lines: number
  summary: string
}

export interface AahpTask {
  title: string
  status: 'ready' | 'in_progress' | 'done' | 'blocked' | 'pending'
  priority: 'high' | 'medium' | 'low'
  depends_on: string[]
  created: string
  completed?: string
  notes?: string
}

export interface AahpManifest {
  aahp_version: string
  version?: string // some repos use "version" key
  project: string
  last_session: {
    agent: string
    session_id?: string
    timestamp: string
    commit: string
    phase: string
    duration_minutes: number
  }
  files: Record<string, AahpFileEntry>
  quick_context: string
  token_budget: {
    manifest_only: number
    manifest_plus_core?: number
    manifest_plus_status_and_actions?: number
    full_read: number
  }
  next_task_id?: number
  tasks?: Record<string, AahpTask>
}

export interface AahpContext {
  manifest: AahpManifest
  status: string | undefined
  nextActions: string | undefined
  conventions: string | undefined
  trust: string | undefined
  workflowMd: string | undefined
  handoffDir: string
}

// ── Reader ────────────────────────────────────────────────────────────────────

function findHandoffDir(workspaceRoot: string): string | undefined {
  const config = vscode.workspace.getConfiguration('aahp')
  const isDevelopmentRoot: boolean = config.get('developmentRoot', false)
  const rootOverride: string = config.get('rootFolderPath', '')
  const scanRoot = rootOverride.trim() || workspaceRoot

  // 1. Direct: scan root itself has .ai/handoff/MANIFEST.json
  const direct = path.join(scanRoot, '.ai', 'handoff')
  if (fs.existsSync(path.join(direct, 'MANIFEST.json'))) return direct

  // 2. Walk up from the currently active editor file (always try this)
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath
  if (activeFile) {
    let dir = path.dirname(activeFile)
    while (dir.length >= scanRoot.length) {
      const candidate = path.join(dir, '.ai', 'handoff')
      if (fs.existsSync(path.join(candidate, 'MANIFEST.json'))) return candidate
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  // 3. Scan immediate subdirectories — only if developmentRoot is true OR rootOverride is set
  if (isDevelopmentRoot || rootOverride.trim()) {
    try {
      const entries = fs.readdirSync(scanRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(scanRoot, entry.name, '.ai', 'handoff')
        if (fs.existsSync(path.join(candidate, 'MANIFEST.json'))) return candidate
      }
    } catch {
      // ignore read errors
    }
  }

  return undefined
}

function readFile(dir: string, name: string): string | undefined {
  const p = path.join(dir, name)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined
}

function parseManifest(dir: string): AahpManifest | undefined {
  const raw = readFile(dir, 'MANIFEST.json')
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as AahpManifest
  } catch {
    return undefined
  }
}

export function loadAahpContext(workspaceRoot: string): AahpContext | undefined {
  const handoffDir = findHandoffDir(workspaceRoot)
  if (!handoffDir) return undefined

  const manifest = parseManifest(handoffDir)
  if (!manifest) return undefined

  return {
    manifest,
    handoffDir,
    status: readFile(handoffDir, 'STATUS.md'),
    nextActions: readFile(handoffDir, 'NEXT_ACTIONS.md'),
    conventions: readFile(handoffDir, 'CONVENTIONS.md'),
    trust: readFile(handoffDir, 'TRUST.md'),
    workflowMd: readFile(handoffDir, 'WORKFLOW.md'),
  }
}

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

/** Returns the top ready/in_progress task from manifest tasks */
export function getTopTask(manifest: AahpManifest): [string, AahpTask] | undefined {
  if (!manifest.tasks) return undefined
  const active = Object.entries(manifest.tasks).find(
    ([, t]) => t.status === 'in_progress'
  )
  if (active) return active
  const ready = Object.entries(manifest.tasks).find(
    ([, t]) => t.status === 'ready'
  )
  return ready
}

/** Build a compact system-prompt string from AAHP context */
export function buildSystemPrompt(ctx: AahpContext): string {
  const m = ctx.manifest
  const topTask = getTopTask(m)
  const taskSummary = topTask
    ? `Current task: [${topTask[0]}] ${topTask[1].title} (${topTask[1].status})`
    : 'No active task'

  const allTasks = m.tasks
    ? Object.entries(m.tasks)
        .filter(([, t]) => t.status !== 'done')
        .map(([id, t]) => `  ${id}: [${t.status}] ${t.title}`)
        .join('\n')
    : ''

  const lines = [
    `## AAHP v3 Context — ${m.project}`,
    `Phase: ${m.last_session.phase}`,
    `Last agent: ${m.last_session.agent} @ ${m.last_session.timestamp}`,
    `Last commit: ${m.last_session.commit}`,
    ``,
    `### Quick Context`,
    m.quick_context,
    ``,
    `### ${taskSummary}`,
    allTasks ? `\nOpen tasks:\n${allTasks}` : '',
  ]

  if (ctx.conventions) {
    lines.push(`\n### Conventions (summary)`)
    // Include only first 50 lines to keep tokens lean
    lines.push(ctx.conventions.split('\n').slice(0, 50).join('\n'))
  }

  if (ctx.trust) {
    lines.push(`\n### Trust State (summary)`)
    lines.push(ctx.trust.split('\n').slice(0, 20).join('\n'))
  }

  lines.push(`\n---\nYou have full project context. Do NOT ask for clarification — act on the above.`)

  return lines.filter(l => l !== undefined).join('\n')
}

/** Update checksum + line count for a file entry in the manifest */
export function refreshManifestChecksums(ctx: AahpContext): AahpManifest {
  const m = { ...ctx.manifest, files: { ...ctx.manifest.files } }
  for (const [filename] of Object.entries(m.files)) {
    const content = readFile(ctx.handoffDir, filename)
    if (!content) continue
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const lines = content.split('\n').length
    const existing = m.files[filename]
    if (existing) {
      m.files[filename] = {
        ...existing,
        checksum: `sha256:${hash}`,
        lines,
        updated: new Date().toISOString(),
      }
    }
  }
  return m
}

/** Persist updated manifest back to disk */
export function saveManifest(ctx: AahpContext, manifest: AahpManifest): void {
  const p = path.join(ctx.handoffDir, 'MANIFEST.json')
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}
