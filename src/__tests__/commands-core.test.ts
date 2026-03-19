/**
 * T-019: Unit tests for the commands module
 * Covers: aahp.updateManifest, aahp.commitSession, aahp.setPhase, aahp.openDashboard,
 *         aahp.setTaskStatus, aahp.retryAgent, aahp.fixTask, aahp.copyTaskId,
 *         aahp.openManifest, aahp.filterTasks, aahp.clearFilter,
 *         aahp.markTaskDone, aahp.setTaskStatusFromTree, aahp.setTaskPriorityFromTree,
 *         aahp.cancelAgent
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { commands, window, env } from 'vscode'
import { registerCommands } from '../commands'
import { AahpManifest, AahpContext } from '../aahp-reader'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<AahpManifest>): AahpManifest {
  return {
    aahp_version: '3',
    project: 'test-project',
    last_session: {
      agent: 'claude-code',
      timestamp: '2026-02-27T10:00:00Z',
      commit: 'abc1234',
      phase: 'implementation',
      duration_minutes: 30,
    },
    files: {
      'src/extension.ts': {
        checksum: 'abc123',
        last_read: '2026-02-27T10:00:00Z',
        purpose: 'extension entry point',
      },
    },
    quick_context: 'A test project',
    token_budget: { manifest_only: 500, full_read: 2000 },
    next_task_id: 5,
    tasks: {
      'T-001': {
        title: 'Fix the bug',
        status: 'ready',
        priority: 'high',
        depends_on: [],
        created: '2026-02-27T10:00:00Z',
      },
      'T-002': {
        title: 'Write tests',
        status: 'in_progress',
        priority: 'medium',
        depends_on: ['T-001'],
        created: '2026-02-27T10:00:00Z',
      },
      'T-003': {
        title: 'Deploy to production',
        status: 'done',
        priority: 'low',
        depends_on: [],
        created: '2026-02-27T10:00:00Z',
        completed: '2026-02-27T12:00:00Z',
      },
    },
    ...overrides,
  }
}

function makeContext(handoffDir: string, manifest?: AahpManifest): AahpContext {
  return {
    manifest: manifest ?? makeManifest(),
    handoffDir,
    status: undefined,
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
  }
}

/** Extract the registered handler for a given command name */
function getCommandHandler(commandName: string): ((...args: unknown[]) => Promise<void> | void) | undefined {
  const call = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    (c: unknown[]) => c[0] === commandName,
  )
  return call ? (call[1] as (...args: unknown[]) => Promise<void>) : undefined
}

// ── Setup helpers ─────────────────────────────────────────────────────────────

let tmpDir: string
let handoffDir: string
let manifestPath: string
let reloadCtx: ReturnType<typeof vi.fn>

function setupTestDir(manifest?: AahpManifest): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-cmd-core-'))
  handoffDir = path.join(tmpDir, '.ai', 'handoff')
  fs.mkdirSync(handoffDir, { recursive: true })
  manifestPath = path.join(handoffDir, 'MANIFEST.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest ?? makeManifest(), null, 2) + '\n', 'utf8')
}

function registerAll(getCtxOverride?: () => AahpContext | undefined): void {
  reloadCtx = vi.fn()
  vi.mocked(commands.registerCommand).mockClear()
  const mockExtCtx = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
  registerCommands(
    mockExtCtx,
    getCtxOverride ?? (() => makeContext(handoffDir)),
    reloadCtx,
  )
}

// ── Tests: aahp.updateManifest ────────────────────────────────────────────────

describe('aahp.updateManifest command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('shows warning when no context is available', async () => {
    const handler = getCommandHandler('aahp.updateManifest')
    expect(handler).toBeDefined()

    vi.mocked(commands.registerCommand).mockClear()
    registerAll(() => undefined)

    const noCtxHandler = getCommandHandler('aahp.updateManifest')
    await noCtxHandler!()
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No MANIFEST.json'),
    )
  })

  it('shows success message after updating checksums', async () => {
    const handler = getCommandHandler('aahp.updateManifest')
    await handler!()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Manifest checksums updated'),
    )
  })

  it('calls reloadCtx after updating manifest', async () => {
    const handler = getCommandHandler('aahp.updateManifest')
    await handler!()
    expect(reloadCtx).toHaveBeenCalled()
  })
})

// ── Tests: aahp.setPhase ──────────────────────────────────────────────────────

describe('aahp.setPhase command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showQuickPick).mockReset()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('shows warning when no context is available', async () => {
    vi.mocked(commands.registerCommand).mockClear()
    registerAll(() => undefined)

    const handler = getCommandHandler('aahp.setPhase')
    await handler!()
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No MANIFEST.json'),
    )
  })

  it('updates the manifest phase when a phase is selected', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('review' as never)
    const handler = getCommandHandler('aahp.setPhase')
    await handler!()

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.last_session.phase).toBe('review')
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('review'),
    )
  })

  it('does nothing when user cancels phase selection', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce(undefined as never)
    const handler = getCommandHandler('aahp.setPhase')
    await handler!()

    expect(reloadCtx).not.toHaveBeenCalled()
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it('calls reloadCtx after setting phase', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('release' as never)
    const handler = getCommandHandler('aahp.setPhase')
    await handler!()
    expect(reloadCtx).toHaveBeenCalled()
  })
})

// ── Tests: aahp.openDashboard ─────────────────────────────────────────────────

describe('aahp.openDashboard command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(commands.executeCommand).mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('executes aahp.dashboard.focus', () => {
    const handler = getCommandHandler('aahp.openDashboard')
    expect(handler).toBeDefined()
    handler!()
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.dashboard.focus')
  })
})

// ── Tests: aahp.setTaskStatus ─────────────────────────────────────────────────

describe('aahp.setTaskStatus command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates task status in manifest', async () => {
    const handler = getCommandHandler('aahp.setTaskStatus')
    await handler!(tmpDir, 'T-001', 'in_progress')

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-001'].status).toBe('in_progress')
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('T-001'),
    )
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('in_progress'),
    )
  })

  it('sets completed timestamp when status is done', async () => {
    const handler = getCommandHandler('aahp.setTaskStatus')
    const before = new Date().toISOString()
    await handler!(tmpDir, 'T-001', 'done')

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-001'].status).toBe('done')
    expect(manifest.tasks['T-001'].completed).toBeDefined()
    expect(new Date(manifest.tasks['T-001'].completed).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime() - 1000,
    )
  })

  it('does nothing when parameters are missing', async () => {
    const handler = getCommandHandler('aahp.setTaskStatus')
    await handler!('', '', '')
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('shows warning on file read error', async () => {
    const handler = getCommandHandler('aahp.setTaskStatus')
    const badPath = '/nonexistent/path'
    await handler!(badPath, 'T-001', 'done')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task'),
    )
  })

  it('calls reloadCtx after updating status', async () => {
    const handler = getCommandHandler('aahp.setTaskStatus')
    await handler!(tmpDir, 'T-002', 'done')
    expect(reloadCtx).toHaveBeenCalled()
  })
})

// ── Tests: aahp.retryAgent ────────────────────────────────────────────────────

describe('aahp.retryAgent command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()
    vi.mocked(window.createTerminal).mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('shows warning when repoPath or taskId is missing', async () => {
    const handler = getCommandHandler('aahp.retryAgent')
    await handler!('', 'T-001')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No repo/task specified'),
    )
  })

  it('shows warning when manifest does not exist', async () => {
    const handler = getCommandHandler('aahp.retryAgent')
    await handler!('/nonexistent/path', 'T-001')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No manifest found'),
    )
  })

  it('shows warning when task not found in manifest', async () => {
    const handler = getCommandHandler('aahp.retryAgent')
    await handler!(tmpDir, 'T-999')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('T-999'),
    )
  })

  it('launches a terminal for a valid task', async () => {
    const mockTerminal = { sendText: vi.fn(), show: vi.fn(), dispose: vi.fn() }
    vi.mocked(window.createTerminal).mockReturnValueOnce(mockTerminal as never)

    const handler = getCommandHandler('aahp.retryAgent')
    await handler!(tmpDir, 'T-001')

    expect(window.createTerminal).toHaveBeenCalled()
    expect(mockTerminal.sendText).toHaveBeenCalledWith(
      expect.stringContaining('aahp-runner'),
    )
    expect(mockTerminal.show).toHaveBeenCalled()
  })

  it('shows information message before launching terminal', async () => {
    const handler = getCommandHandler('aahp.retryAgent')
    await handler!(tmpDir, 'T-001')
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Retrying'),
    )
  })
})

// ── Tests: aahp.copyTaskId ────────────────────────────────────────────────────

describe('aahp.copyTaskId command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(env.clipboard.writeText).mockClear()
    vi.mocked(window.showInformationMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('copies the task ID to clipboard', () => {
    const handler = getCommandHandler('aahp.copyTaskId')
    expect(handler).toBeDefined()
    handler!({ taskId: 'T-042', repoPath: tmpDir, task: {}, repoName: 'test' })
    expect(env.clipboard.writeText).toHaveBeenCalledWith('T-042')
  })

  it('shows confirmation message after copying', () => {
    const handler = getCommandHandler('aahp.copyTaskId')
    handler!({ taskId: 'T-007', repoPath: tmpDir, task: {}, repoName: 'test' })
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('T-007'),
    )
  })

  it('does nothing when taskId is missing', () => {
    const handler = getCommandHandler('aahp.copyTaskId')
    handler!({ taskId: '', repoPath: tmpDir, task: {}, repoName: 'test' })
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('does nothing when element is undefined', () => {
    const handler = getCommandHandler('aahp.copyTaskId')
    handler!(undefined)
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })
})

// ── Tests: aahp.markTaskDone ──────────────────────────────────────────────────

describe('aahp.markTaskDone command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(commands.executeCommand).mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('delegates to aahp.setTaskStatus with done', () => {
    const handler = getCommandHandler('aahp.markTaskDone')
    expect(handler).toBeDefined()
    handler!({ repoPath: tmpDir, taskId: 'T-001', task: {}, repoName: 'test' })
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'aahp.setTaskStatus',
      tmpDir,
      'T-001',
      'done',
    )
  })

  it('does nothing when element has no repoPath', () => {
    const handler = getCommandHandler('aahp.markTaskDone')
    handler!({ repoPath: '', taskId: 'T-001', task: {}, repoName: 'test' })
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })

  it('does nothing when element has no taskId', () => {
    const handler = getCommandHandler('aahp.markTaskDone')
    handler!({ repoPath: tmpDir, taskId: '', task: {}, repoName: 'test' })
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })
})

// ── Tests: aahp.setTaskStatusFromTree ────────────────────────────────────────

describe('aahp.setTaskStatusFromTree command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showQuickPick).mockReset()
    vi.mocked(commands.executeCommand).mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('executes setTaskStatus with selected status', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('blocked' as never)
    const element = {
      repoPath: tmpDir,
      taskId: 'T-001',
      task: { status: 'ready' },
      repoName: 'test',
    }
    const handler = getCommandHandler('aahp.setTaskStatusFromTree')
    await handler!(element)
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'aahp.setTaskStatus',
      tmpDir,
      'T-001',
      'blocked',
    )
  })

  it('does nothing when user cancels status selection', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce(undefined as never)
    const element = { repoPath: tmpDir, taskId: 'T-001', task: { status: 'ready' }, repoName: 'test' }
    const handler = getCommandHandler('aahp.setTaskStatusFromTree')
    await handler!(element)
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })

  it('does nothing when element has no repoPath or taskId', async () => {
    const handler = getCommandHandler('aahp.setTaskStatusFromTree')
    await handler!({ repoPath: '', taskId: '', task: {}, repoName: '' })
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })
})

// ── Tests: aahp.setTaskPriorityFromTree ──────────────────────────────────────

describe('aahp.setTaskPriorityFromTree command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showQuickPick).mockReset()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates task priority in manifest', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('low' as never)
    const element = { repoPath: tmpDir, taskId: 'T-001', task: { priority: 'high' }, repoName: 'test' }
    const handler = getCommandHandler('aahp.setTaskPriorityFromTree')
    await handler!(element)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-001'].priority).toBe('low')
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('T-001'),
    )
  })

  it('does nothing when user cancels priority selection', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce(undefined as never)
    const element = { repoPath: tmpDir, taskId: 'T-001', task: { priority: 'high' }, repoName: 'test' }
    const handler = getCommandHandler('aahp.setTaskPriorityFromTree')
    await handler!(element)
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('does nothing when element missing repoPath or taskId', async () => {
    const handler = getCommandHandler('aahp.setTaskPriorityFromTree')
    await handler!({ repoPath: '', taskId: '', task: {}, repoName: '' })
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('shows warning on file error', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('high' as never)
    const element = { repoPath: '/nonexistent', taskId: 'T-001', task: { priority: 'low' }, repoName: 'test' }
    const handler = getCommandHandler('aahp.setTaskPriorityFromTree')
    await handler!(element)
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update priority'),
    )
  })

  it('calls reloadCtx after updating priority', async () => {
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)
    const element = { repoPath: tmpDir, taskId: 'T-002', task: { priority: 'high' }, repoName: 'test' }
    const handler = getCommandHandler('aahp.setTaskPriorityFromTree')
    await handler!(element)
    expect(reloadCtx).toHaveBeenCalled()
  })
})

// ── Tests: aahp.filterTasks ───────────────────────────────────────────────────

describe('aahp.filterTasks command', () => {
  let mockTaskTreeProvider: { setFilter: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    setupTestDir()
    mockTaskTreeProvider = { setFilter: vi.fn() }
    reloadCtx = vi.fn()
    vi.mocked(commands.registerCommand).mockClear()
    const mockExtCtx = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
    registerCommands(
      mockExtCtx,
      () => makeContext(handoffDir),
      reloadCtx,
      undefined,
      undefined,
      undefined,
      mockTaskTreeProvider as never,
    )
    vi.mocked(window.showInputBox).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls setFilter with entered text', async () => {
    vi.mocked(window.showInputBox).mockResolvedValueOnce('T-001')
    const handler = getCommandHandler('aahp.filterTasks')
    await handler!()
    expect(mockTaskTreeProvider.setFilter).toHaveBeenCalledWith('T-001')
  })

  it('calls setFilter with empty string when user clears input', async () => {
    vi.mocked(window.showInputBox).mockResolvedValueOnce('')
    const handler = getCommandHandler('aahp.filterTasks')
    await handler!()
    expect(mockTaskTreeProvider.setFilter).toHaveBeenCalledWith('')
  })

  it('does NOT call setFilter when user cancels (undefined)', async () => {
    vi.mocked(window.showInputBox).mockResolvedValueOnce(undefined)
    const handler = getCommandHandler('aahp.filterTasks')
    await handler!()
    expect(mockTaskTreeProvider.setFilter).not.toHaveBeenCalled()
  })
})

// ── Tests: aahp.clearFilter ───────────────────────────────────────────────────

describe('aahp.clearFilter command', () => {
  let mockTaskTreeProvider: { setFilter: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    setupTestDir()
    mockTaskTreeProvider = { setFilter: vi.fn() }
    reloadCtx = vi.fn()
    vi.mocked(commands.registerCommand).mockClear()
    const mockExtCtx = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
    registerCommands(
      mockExtCtx,
      () => makeContext(handoffDir),
      reloadCtx,
      undefined,
      undefined,
      undefined,
      mockTaskTreeProvider as never,
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls setFilter with empty string', () => {
    const handler = getCommandHandler('aahp.clearFilter')
    expect(handler).toBeDefined()
    handler!()
    expect(mockTaskTreeProvider.setFilter).toHaveBeenCalledWith('')
  })
})

// ── Tests: command registration ───────────────────────────────────────────────

describe('registerCommands - command registration', () => {
  beforeEach(() => {
    setupTestDir()
    vi.mocked(commands.registerCommand).mockClear()
    registerAll()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('registers all expected commands', () => {
    const registeredNames = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    )
    const expected = [
      'aahp.updateManifest',
      'aahp.commitSession',
      'aahp.setPhase',
      'aahp.openDashboard',
      'aahp.runAll',
      'aahp.focusRepo',
      'aahp.runSingleRepo',
      'aahp.runRepoAutonomous',
      'aahp.createMissingGitHubIssues',
      'aahp.setTaskStatus',
      'aahp.retryAgent',
      'aahp.fixTask',
      'aahp.launchTask',
      'aahp.openTaskOnGitHub',
      'aahp.setTaskStatusFromTree',
      'aahp.markTaskDone',
      'aahp.setTaskPriorityFromTree',
      'aahp.focusRepoFromTree',
      'aahp.copyTaskId',
      'aahp.openManifest',
      'aahp.createTaskFromTree',
      'aahp.createTask',
      'aahp.cancelAgent',
      'aahp.filterTasks',
      'aahp.clearFilter',
      'aahp.openLogEntry',
      'aahp.openAgentHistory',
    ]
    for (const name of expected) {
      expect(registeredNames).toContain(name)
    }
  })

  it('returns an array of disposables', () => {
    vi.mocked(commands.registerCommand).mockClear()
    const mockExtCtx = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
    const disposables = registerCommands(
      mockExtCtx,
      () => makeContext(handoffDir),
      vi.fn(),
    )
    expect(Array.isArray(disposables)).toBe(true)
    expect(disposables.length).toBeGreaterThan(0)
  })
})

// ── Tests: aahp.cancelAgent ────────────────────────────────────────────────────

describe('aahp.cancelAgent command', () => {
  beforeEach(() => {
    setupTestDir()
    registerAll()
    vi.mocked(window.showInformationMessage).mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does nothing when run index is out of bounds (no current runs)', () => {
    const handler = getCommandHandler('aahp.cancelAgent')
    expect(handler).toBeDefined()
    // No runs registered, so index 0 is out of bounds - should not throw
    expect(() => handler!(0)).not.toThrow()
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })
})
