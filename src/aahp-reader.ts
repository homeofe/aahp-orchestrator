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
  github_issue?: number
  github_repo?: string
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

// ── Next Actions (parsed from NEXT_ACTIONS.md) ──────────────────────────────

export interface NextActionItem {
  section: 'ready' | 'in_progress' | 'blocked' | 'done' | 'unknown'
  taskId?: string
  title: string
  detail?: string
  priority?: string
}

/** Parse a NEXT_ACTIONS.md file into structured items.
 *  Handles multiple formats: AAHP template, checklist, numbered list, phase-based. */
export function parseNextActions(markdown: string): NextActionItem[] {
  if (!markdown?.trim()) return []

  const mdLines = markdown.split('\n')
  const items: NextActionItem[] = []
  let currentSection: NextActionItem['section'] = 'unknown'

  for (let i = 0; i < mdLines.length; i++) {
    const currentLine = mdLines[i]
    if (!currentLine) continue
    const trimmed = currentLine.trim()

    // Detect section headers (## or ### level)
    const sectionMatch = trimmed.match(/^#{1,3}\s+(.+)/)
    if (sectionMatch && sectionMatch[1]) {
      const heading = sectionMatch[1].toLowerCase()
      // Strip emoji and non-ASCII prefixes for matching
      // eslint-disable-next-line no-control-regex
      const cleaned = heading.replace(/[^\x20-\x7E]/g, '').trim()

      if (/ready|work these next|next steps|open tasks?/i.test(cleaned)) {
        currentSection = 'ready'
      } else if (/in.?progress|active|running|current/i.test(cleaned)) {
        currentSection = 'in_progress'
      } else if (/blocked|cannot start/i.test(cleaned)) {
        currentSection = 'blocked'
      } else if (/done|completed|recently completed/i.test(cleaned)) {
        currentSection = 'done'
      }

      // Check if heading is a task: ## T-NNN: Title or ### T-NNN: Title or ### Title *(priority)*
      const taskHeading = trimmed.match(/^#{2,3}\s+(?:~~)?(?:(T-\d+)[:\s]+)?(.+?)(?:~~)?(?:\s*\*\((high|medium|low)\s*priority\)\*)?$/)
      if (taskHeading && taskHeading[2]) {
        const rawTitle = taskHeading[2].replace(/\*+/g, '').trim()
        if (rawTitle && !/^(ready|blocked|done|in.?progress|recently completed|status summary|reference|open tasks?)\b/i.test(rawTitle)) {
          const isStrikethrough = trimmed.includes('~~')
          const itemSection = isStrikethrough ? 'done' : currentSection

          let detail: string | undefined
          for (let j = i + 1; j < Math.min(i + 6, mdLines.length); j++) {
            const lookLine = mdLines[j]
            if (!lookLine) continue
            const goalMatch = lookLine.match(/^\*\*Goal:\*\*\s*(.+)/)
            if (goalMatch && goalMatch[1]) {
              detail = goalMatch[1].trim().slice(0, 120)
              break
            }
          }

          let priority = taskHeading[3]
          if (!priority) {
            const priMatch = trimmed.match(/\*\(?(high|medium|low)\s*priority\)?\*/i)
            if (priMatch && priMatch[1]) priority = priMatch[1].toLowerCase()
          }

          const item: NextActionItem = { section: itemSection, title: rawTitle }
          if (taskHeading[1]) item.taskId = taskHeading[1]
          if (detail) item.detail = detail
          if (priority) item.priority = priority
          items.push(item)
        }
      }
      continue
    }

    // Checkbox items: - [ ] text / - [x] text
    const checkMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)/)
    if (checkMatch && checkMatch[1] && checkMatch[2]) {
      const isDone = checkMatch[1].toLowerCase() === 'x'
      const rawTitle = checkMatch[2].replace(/\*+/g, '').trim()
      const priMatch = rawTitle.match(/\(?(high|medium|low)\s*priority\)?/i)
      const item: NextActionItem = {
        section: isDone ? 'done' : currentSection,
        title: rawTitle.replace(/\(?(high|medium|low)\s*priority\)?/i, '').trim(),
      }
      if (priMatch && priMatch[1]) item.priority = priMatch[1].toLowerCase()
      items.push(item)
      continue
    }

    // Numbered list items (only in a known section, skip instruction steps)
    if (currentSection !== 'unknown') {
      const numMatch = trimmed.match(/^\d+\.\s+(.+)/)
      if (numMatch && numMatch[1]) {
        const rawTitle = numMatch[1].replace(/\*+/g, '').trim()
        if (rawTitle.length > 5 && rawTitle.length < 200 && !/^(add|create|run|install|update|verify|test|check|open|set|write|read|import|export|mock|show|use)\s/i.test(rawTitle)) {
          const isDone = /~~.+~~/.test(rawTitle) || /\bDONE\b/i.test(rawTitle)
          const priMatch = rawTitle.match(/\(?(high|medium|low)\s*priority\)?/i)
          const taskIdMatch = rawTitle.match(/(T-\d+)/)
          const item: NextActionItem = {
            section: isDone ? 'done' : currentSection,
            title: rawTitle.replace(/~~(.+)~~/, '$1').replace(/\s*-\s*DONE.*$/i, '').replace(/\(?(high|medium|low)\s*priority\)?/i, '').trim(),
          }
          if (taskIdMatch && taskIdMatch[1]) item.taskId = taskIdMatch[1]
          if (priMatch && priMatch[1]) item.priority = priMatch[1].toLowerCase()
          items.push(item)
        }
      }
    }
  }

  return items
}

// ── Repo Overview (multi-repo scanning) ──────────────────────────────────────

export interface RepoOverview {
  repoPath: string
  repoName: string
  manifest: AahpManifest
  handoffDir: string
  hasManifest: true
  taskCounts: {
    total: number
    ready: number
    inProgress: number
    done: number
    blocked: number
    pending: number
  }
  lastActivity: string   // ISO timestamp from last_session.timestamp
  health: 'healthy' | 'stale' | 'no-tasks'
  nextActions: NextActionItem[]
  githubUrl?: string      // HTTPS URL to the GitHub repo (if detected)
}

/** Read the git remote origin URL and convert to an HTTPS GitHub URL.
 *  Returns undefined if no GitHub remote is found. */
function getGithubUrl(repoPath: string): string | undefined {
  try {
    const gitConfigPath = path.join(repoPath, '.git', 'config')
    if (!fs.existsSync(gitConfigPath)) return undefined
    const content = fs.readFileSync(gitConfigPath, 'utf8')
    // Match [remote "origin"] section and extract url
    const originMatch = content.match(/\[remote\s+"origin"\][^[]*url\s*=\s*(.+)/m)
    if (!originMatch?.[1]) return undefined
    const url = originMatch[1].trim()
    // Convert SSH to HTTPS: git@github.com:user/repo.git -> https://github.com/user/repo
    const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/)
    if (sshMatch?.[1]) return `https://github.com/${sshMatch[1]}`
    // Already HTTPS: https://github.com/user/repo.git -> https://github.com/user/repo
    const httpsMatch = url.match(/(https:\/\/github\.com\/[^/]+\/[^/]+?)(?:\.git)?$/)
    if (httpsMatch?.[1]) return httpsMatch[1]
    return undefined
  } catch { return undefined }
}

/** Cross-reference parsed NEXT_ACTIONS items with MANIFEST.json task statuses.
 *  Items with section 'unknown' get their section inferred from the manifest task status. */
function inferSectionsFromManifest(items: NextActionItem[], tasks: Record<string, AahpTask>): NextActionItem[] {
  return items.map(item => {
    if (item.section !== 'unknown') return item
    if (item.taskId && tasks[item.taskId]) {
      const manifestStatus = tasks[item.taskId]!.status
      const sectionMap: Record<string, NextActionItem['section']> = {
        ready: 'ready', in_progress: 'in_progress', blocked: 'blocked',
        done: 'done', pending: 'ready',
      }
      return { ...item, section: sectionMap[manifestStatus] ?? 'ready' }
    }
    // No task ID or task not in manifest - default to ready
    return { ...item, section: 'ready' }
  })
}

/** Scan all subdirectories of rootDir for repos with AAHP manifests.
 *  Returns an overview for every repo that has a manifest - regardless of task state.
 *  Sorted: in_progress repos first, then ready, then alphabetical. */
export function scanAllRepoOverviews(rootDir: string): RepoOverview[] {
  const results: RepoOverview[] = []
  if (!fs.existsSync(rootDir)) return results

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const repoPath = path.join(rootDir, entry.name)
    const handoffDir = path.join(repoPath, '.ai', 'handoff')
    const manifestPath = path.join(handoffDir, 'MANIFEST.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AahpManifest
      const tasks = manifest.tasks ?? {}
      const taskEntries = Object.values(tasks)

      const taskCounts = {
        total: taskEntries.length,
        ready: taskEntries.filter(t => t.status === 'ready').length,
        inProgress: taskEntries.filter(t => t.status === 'in_progress').length,
        done: taskEntries.filter(t => t.status === 'done').length,
        blocked: taskEntries.filter(t => t.status === 'blocked').length,
        pending: taskEntries.filter(t => t.status === 'pending').length,
      }

      const lastActivity = manifest.last_session?.timestamp ?? ''
      const daysSinceActivity = lastActivity
        ? (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
        : Infinity

      let health: 'healthy' | 'stale' | 'no-tasks' = 'healthy'
      if (taskCounts.total === 0) health = 'no-tasks'
      else if (daysSinceActivity > 7) health = 'stale'

      // Parse NEXT_ACTIONS.md for structured next-step items
      const nextActionsMd = readFile(handoffDir, 'NEXT_ACTIONS.md')
      let nextActions = nextActionsMd ? parseNextActions(nextActionsMd) : []

      // Cross-reference with MANIFEST.json to fix 'unknown' sections
      nextActions = inferSectionsFromManifest(nextActions, tasks)

      // Detect GitHub remote URL
      const githubUrl = getGithubUrl(repoPath)

      const overview: RepoOverview = {
        repoPath,
        repoName: entry.name,
        manifest,
        handoffDir,
        hasManifest: true,
        taskCounts,
        lastActivity,
        health,
        nextActions,
      }
      if (githubUrl) overview.githubUrl = githubUrl
      results.push(overview)
    } catch { /* skip malformed manifests */ }
  }

  return results.sort((a, b) => {
    if (a.taskCounts.inProgress > 0 && b.taskCounts.inProgress === 0) return -1
    if (b.taskCounts.inProgress > 0 && a.taskCounts.inProgress === 0) return 1
    if (a.taskCounts.ready > 0 && b.taskCounts.ready === 0) return -1
    if (b.taskCounts.ready > 0 && a.taskCounts.ready === 0) return 1
    return a.repoName.localeCompare(b.repoName)
  })
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

  // 3. Scan immediate subdirectories - only if developmentRoot is true OR rootOverride is set
  if (isDevelopmentRoot || rootOverride.trim()) {
    try {
      const scanEntries = fs.readdirSync(scanRoot, { withFileTypes: true })
      for (const scanEntry of scanEntries) {
        if (!scanEntry.isDirectory()) continue
        const candidate = path.join(scanRoot, scanEntry.name, '.ai', 'handoff')
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

/** Load AAHP context from an explicit handoff directory path (for multi-repo dashboard). */
export function loadAahpContextByPath(handoffDir: string): AahpContext | undefined {
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

  const taskLines = [
    `## AAHP v3 Context - ${m.project}`,
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
    taskLines.push(`\n### Conventions (summary)`)
    // Include only first 50 lines to keep tokens lean
    taskLines.push(ctx.conventions.split('\n').slice(0, 50).join('\n'))
  }

  if (ctx.trust) {
    taskLines.push(`\n### Trust State (summary)`)
    taskLines.push(ctx.trust.split('\n').slice(0, 20).join('\n'))
  }

  taskLines.push(`\n---\nYou have full project context. Do NOT ask for clarification - act on the above.`)

  return taskLines.filter(l => l !== undefined).join('\n')
}

/** Update checksum + line count for a file entry in the manifest */
export function refreshManifestChecksums(ctx: AahpContext): AahpManifest {
  const m = { ...ctx.manifest, files: { ...ctx.manifest.files } }
  for (const [filename] of Object.entries(m.files)) {
    const content = readFile(ctx.handoffDir, filename)
    if (!content) continue
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const lineCount = content.split('\n').length
    const existing = m.files[filename]
    if (existing) {
      m.files[filename] = {
        ...existing,
        checksum: `sha256:${hash}`,
        lines: lineCount,
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
