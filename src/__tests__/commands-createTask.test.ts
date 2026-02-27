import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { commands, window } from 'vscode'
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
    files: {},
    quick_context: 'A test project',
    token_budget: { manifest_only: 500, full_read: 2000 },
    next_task_id: 5,
    tasks: {
      'T-001': {
        title: 'Existing task',
        status: 'done',
        priority: 'high',
        depends_on: [],
        created: '2026-02-27T10:00:00Z',
        completed: '2026-02-27T11:00:00Z',
      },
    },
    ...overrides,
  }
}

function makeContext(tmpDir: string, manifest?: AahpManifest): AahpContext {
  return {
    manifest: manifest ?? makeManifest(),
    handoffDir: tmpDir,
    status: undefined,
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
  }
}

/** Extract the handler registered for a given command name from the mock calls */
function getCommandHandler(commandName: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    (c: unknown[]) => c[0] === commandName
  )
  return call ? (call[1] as (...args: unknown[]) => Promise<void>) : undefined
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('aahp.createTask command', () => {
  let tmpDir: string
  let reloadCtx: ReturnType<typeof vi.fn>
  let manifestPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-cmd-'))
    const handoffDir = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoffDir, { recursive: true })
    manifestPath = path.join(handoffDir, 'MANIFEST.json')
    fs.writeFileSync(manifestPath, JSON.stringify(makeManifest(), null, 2) + '\n', 'utf8')

    reloadCtx = vi.fn()
    vi.mocked(commands.registerCommand).mockClear()
    vi.mocked(window.showInputBox).mockReset()
    vi.mocked(window.showQuickPick).mockReset()
    vi.mocked(window.showInformationMessage).mockReset()
    vi.mocked(window.showWarningMessage).mockReset()

    // Register commands with a mock context
    const mockExtContext = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
    registerCommands(
      mockExtContext,
      () => makeContext(handoffDir),
      reloadCtx,
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates a task with correct ID, title, priority, and status', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Implement new feature')  // title
      .mockResolvedValueOnce('')                         // depends_on (empty)
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)

    const handler = getCommandHandler('aahp.createTask')
    expect(handler).toBeDefined()
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005']).toBeDefined()
    expect(manifest.tasks['T-005'].title).toBe('Implement new feature')
    expect(manifest.tasks['T-005'].priority).toBe('medium')
    expect(manifest.tasks['T-005'].status).toBe('ready')
    expect(manifest.tasks['T-005'].depends_on).toEqual([])
    expect(manifest.tasks['T-005'].created).toBeDefined()
    expect(manifest.next_task_id).toBe(6)
  })

  it('sets status to blocked when dependencies are provided', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Blocked task')            // title
      .mockResolvedValueOnce('T-001, T-003')            // depends_on
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('high' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005'].status).toBe('blocked')
    expect(manifest.tasks['T-005'].depends_on).toEqual(['T-001', 'T-003'])
  })

  it('increments next_task_id correctly', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('First new task')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('low' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.next_task_id).toBe(6)

    // Create a second task
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Second new task')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)
    await handler!(tmpDir)

    const manifest2 = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest2.tasks['T-006']).toBeDefined()
    expect(manifest2.tasks['T-006'].title).toBe('Second new task')
    expect(manifest2.next_task_id).toBe(7)
  })

  it('pads task ID with leading zeros', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Test padding')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    // next_task_id is 5, so ID should be T-005
    expect(manifest.tasks['T-005']).toBeDefined()
  })

  it('does nothing when user cancels title input', async () => {
    vi.mocked(window.showInputBox).mockResolvedValueOnce(undefined)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005']).toBeUndefined()
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('does nothing when user cancels priority selection', async () => {
    vi.mocked(window.showInputBox).mockResolvedValueOnce('A task')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce(undefined as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005']).toBeUndefined()
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('does nothing when user cancels depends_on input', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('A task')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)
    // Return undefined for depends_on (cancel)
    vi.mocked(window.showInputBox).mockResolvedValueOnce(undefined)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005']).toBeUndefined()
    expect(reloadCtx).not.toHaveBeenCalled()
  })

  it('shows warning when no repo path is available', async () => {
    const handler = getCommandHandler('aahp.createTask')
    // Pass undefined/empty repo path, and no dashboard provider
    await handler!(undefined)

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No repo selected')
    )
  })

  it('shows warning when MANIFEST.json does not exist', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-empty-'))
    try {
      const handler = getCommandHandler('aahp.createTask')
      await handler!(emptyDir)

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No MANIFEST.json')
      )
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('calls reloadCtx after successful creation', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Task that triggers reload')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    expect(reloadCtx).toHaveBeenCalled()
  })

  it('shows success message with task ID and title', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('My new task')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('high' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('T-005')
    )
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('My new task')
    )
  })

  it('initializes tasks object when manifest has no tasks', async () => {
    // Write manifest without tasks
    const noTaskManifest = makeManifest({ tasks: undefined, next_task_id: 1 })
    fs.writeFileSync(manifestPath, JSON.stringify(noTaskManifest, null, 2) + '\n', 'utf8')

    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('First ever task')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('high' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks).toBeDefined()
    expect(manifest.tasks['T-001']).toBeDefined()
    expect(manifest.tasks['T-001'].title).toBe('First ever task')
  })

  it('trims whitespace from title', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('  Spaces around title  ')
      .mockResolvedValueOnce('')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005'].title).toBe('Spaces around title')
  })

  it('filters empty strings from depends_on', async () => {
    vi.mocked(window.showInputBox)
      .mockResolvedValueOnce('Filtered deps task')
      .mockResolvedValueOnce('T-001, , T-003, ')
    vi.mocked(window.showQuickPick).mockResolvedValueOnce('medium' as never)

    const handler = getCommandHandler('aahp.createTask')
    await handler!(tmpDir)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.tasks['T-005'].depends_on).toEqual(['T-001', 'T-003'])
  })
})
