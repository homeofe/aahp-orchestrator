import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActiveSession {
  repoPath: string
  repoName: string
  taskId: string
  taskTitle: string
  backend: 'claude' | 'copilot'
  startedAt: string   // ISO — must be JSON-serializable for globalState + lock file
  pid?: number
}

export interface QueuedTask {
  repoPath: string
  repoName: string
  taskId: string
  taskTitle: string
  queuedAt: string    // ISO
}

export interface VSCodeState {
  terminals: Array<{ name: string; isAgentSession: boolean }>
  agentTerminals: number
  runningTasks: Array<{ name: string; source: string }>
  hasUnsavedChanges: boolean
  activeFile: string | undefined
  debugSession: string | undefined
  /** true when VS Code has running build/debug tasks that may conflict */
  isVSCodeBusy: boolean
}

/** Shared lock file path — both extension and CLI read/write this */
export const LOCK_FILE = path.join(os.homedir(), '.aahp', 'sessions.json')

// ── SessionMonitor ────────────────────────────────────────────────────────────

/**
 * Tracks running AAHP agent sessions across VS Code restarts via globalState.
 * Writes a shared lock file so the CLI (`aahp-runner`) can also see what's running.
 *
 * Key behaviours:
 *  - `isRepoActive(repoPath)` → true if an agent is already running for that repo
 *  - `enqueue(task)` → stores a task to be run after the current session finishes
 *  - After each agent run, call `drainQueue(repoPath, spawnFn)` to auto-start next task
 *  - `getVSCodeState()` → snapshot of VS Code terminals, tasks, editor state
 */
export class SessionMonitor {
  private readonly _listeners: Array<() => void> = []

  constructor(private readonly _ctx: vscode.ExtensionContext) {}

  // ── Active sessions ───────────────────────────────────────────────────────

  getActiveSessions(): ActiveSession[] {
    return this._ctx.globalState.get<ActiveSession[]>('aahp.activeSessions', [])
  }

  isRepoActive(repoPath: string): boolean {
    return this.getActiveSessions().some(s => s.repoPath === repoPath)
  }

  async registerSession(session: ActiveSession): Promise<void> {
    const sessions = this.getActiveSessions().filter(s => s.repoPath !== session.repoPath)
    sessions.push(session)
    await this._ctx.globalState.update('aahp.activeSessions', sessions)
    this._writeLockFile(sessions)
    this._notify()
  }

  async deregisterSession(repoPath: string): Promise<void> {
    const sessions = this.getActiveSessions().filter(s => s.repoPath !== repoPath)
    await this._ctx.globalState.update('aahp.activeSessions', sessions)
    this._writeLockFile(sessions)
    this._notify()
  }

  /** Clear all sessions — call on extension activate to remove stale entries from a previous VS Code session */
  async clearStaleSessions(): Promise<void> {
    await this._ctx.globalState.update('aahp.activeSessions', [])
    this._writeLockFile([])
    this._notify()
  }

  /** Clear the task queue — call on extension activate to remove tasks stuck in queue due to stale sessions */
  async clearQueue(): Promise<void> {
    await this._ctx.globalState.update('aahp.taskQueue', [])
    this._notify()
  }

  // ── Task queue ────────────────────────────────────────────────────────────

  getQueue(): QueuedTask[] {
    return this._ctx.globalState.get<QueuedTask[]>('aahp.taskQueue', [])
  }

  async enqueue(task: QueuedTask): Promise<void> {
    const queue = this.getQueue()
    // Don't double-queue the same repo+task
    if (!queue.some(q => q.repoPath === task.repoPath && q.taskId === task.taskId)) {
      queue.push(task)
      await this._ctx.globalState.update('aahp.taskQueue', queue)
      this._notify()
    }
  }

  async dequeue(repoPath: string): Promise<QueuedTask | undefined> {
    const queue = this.getQueue()
    const idx = queue.findIndex(q => q.repoPath === repoPath)
    if (idx === -1) return undefined
    const [task] = queue.splice(idx, 1)
    await this._ctx.globalState.update('aahp.taskQueue', queue)
    this._notify()
    return task
  }

  /**
   * After an agent finishes for `repoPath`, auto-spawn the next queued task if one exists.
   * `spawnFn` is provided by the caller (agent-spawner) to avoid circular imports.
   */
  async drainQueue(repoPath: string, spawnFn: (task: QueuedTask) => Promise<void>): Promise<void> {
    const next = await this.dequeue(repoPath)
    if (next) {
      vscode.window.showInformationMessage(
        `AAHP: Starting queued task for ${next.repoName}: [${next.taskId}] ${next.taskTitle}`
      )
      await spawnFn(next)
    }
  }

  // ── VS Code state introspection ───────────────────────────────────────────

  /**
   * Returns a live snapshot of what VS Code is currently doing.
   *
   * Sources:
   *   - vscode.window.terminals     — open terminals (detect claude/aahp agent terminals)
   *   - vscode.tasks.taskExecutions — running build/test tasks
   *   - vscode.debug.activeDebugSession — active debugger
   *   - vscode.window.activeTextEditor  — current file + unsaved state
   */
  getVSCodeState(): VSCodeState {
    const terminals = vscode.window.terminals.map(t => ({
      name: t.name,
      isAgentSession: /claude|aahp|copilot/i.test(t.name),
    }))

    const runningTasks = vscode.tasks.taskExecutions.map(e => ({
      name: e.task.name,
      source: e.task.source ?? '',
    }))

    const activeEditor = vscode.window.activeTextEditor
    const debugSession = vscode.debug.activeDebugSession

    return {
      terminals,
      agentTerminals: terminals.filter(t => t.isAgentSession).length,
      runningTasks,
      hasUnsavedChanges: activeEditor?.document.isDirty ?? false,
      activeFile: activeEditor?.document.fileName,
      debugSession: debugSession?.name,
      isVSCodeBusy: runningTasks.length > 0 || debugSession !== undefined,
    }
  }

  // ── Change notifications ──────────────────────────────────────────────────

  onChange(fn: () => void): void {
    this._listeners.push(fn)
  }

  private _notify(): void {
    for (const fn of this._listeners) fn()
  }

  // ── Shared lock file (readable by aahp-runner CLI) ────────────────────────

  private _writeLockFile(sessions: ActiveSession[]): void {
    try {
      const dir = path.dirname(LOCK_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        updatedAt: new Date().toISOString(),
        sessions,
      }, null, 2), 'utf8')
    } catch { /* best-effort — lock file is informational only */ }
  }

  /** Read the lock file without needing a VS Code context — used by CLI */
  static readLockFile(): { updatedAt: string; sessions: ActiveSession[] } | null {
    try {
      if (!fs.existsSync(LOCK_FILE)) return null
      return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as { updatedAt: string; sessions: ActiveSession[] }
    } catch { return null }
  }
}
