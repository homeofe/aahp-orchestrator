import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { registerChatParticipant } from '../chat-participant'
import { AahpContext, AahpManifest, AahpTask } from '../aahp-reader'
import {
  chat,
  lm,
  CancellationTokenSource,
  LanguageModelError,
  ChatRequestTurn,
  ChatResponseTurn,
  ChatResponseMarkdownPart,
} from 'vscode'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<AahpTask>): AahpTask {
  return {
    title: 'Test task',
    status: 'ready',
    priority: 'medium',
    depends_on: [],
    created: '2026-02-27T10:00:00Z',
    ...overrides,
  }
}

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
    quick_context: 'A test project for unit testing',
    token_budget: { manifest_only: 500, full_read: 2000 },
    ...overrides,
  }
}

function makeContext(overrides?: Partial<AahpContext>): AahpContext {
  return {
    manifest: makeManifest(),
    handoffDir: '/tmp/test/.ai/handoff',
    status: undefined,
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
    ...overrides,
  }
}

function makeExtensionContext(): {
  subscriptions: { dispose: ReturnType<typeof vi.fn> }[]
} {
  return { subscriptions: [] }
}

interface MockStream {
  markdown: ReturnType<typeof vi.fn>
}

function makeStream(): MockStream {
  return { markdown: vi.fn() }
}

function makeRequest(command?: string, prompt = ''): {
  command: string | undefined
  prompt: string
} {
  return { command, prompt }
}

function makeChatContext(
  history: unknown[] = [],
): { history: unknown[] } {
  return { history }
}

// Capture the chat handler callback from createChatParticipant
function getChatHandler(
  getCtx: () => AahpContext | undefined,
): (
  request: { command: string | undefined; prompt: string },
  chatContext: { history: unknown[] },
  stream: MockStream,
  token: { isCancellationRequested: boolean },
) => Promise<void> {
  const extCtx = makeExtensionContext()
  registerChatParticipant(extCtx as never, getCtx)
  const call = (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls[0]
  return call![1] as (
    request: { command: string | undefined; prompt: string },
    chatContext: { history: unknown[] },
    stream: MockStream,
    token: { isCancellationRequested: boolean },
  ) => Promise<void>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerChatParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a chat participant with id aahp.orchestrator', () => {
    const extCtx = makeExtensionContext()
    registerChatParticipant(extCtx as never, () => undefined)
    expect(chat.createChatParticipant).toHaveBeenCalledWith(
      'aahp.orchestrator',
      expect.any(Function),
    )
  })

  it('returns a disposable', () => {
    const extCtx = makeExtensionContext()
    const disposable = registerChatParticipant(extCtx as never, () => undefined)
    expect(disposable).toBeDefined()
    expect(typeof disposable.dispose).toBe('function')
  })

  it('sets robot icon on participant', () => {
    const mockParticipant = {
      iconPath: undefined as unknown,
      followupProvider: undefined as unknown,
      dispose: vi.fn(),
    }
    ;(chat.createChatParticipant as ReturnType<typeof vi.fn>).mockReturnValue(mockParticipant)
    const extCtx = makeExtensionContext()
    registerChatParticipant(extCtx as never, () => undefined)
    expect(mockParticipant.iconPath).toBeDefined()
  })

  it('sets a followup provider', () => {
    const mockParticipant = {
      iconPath: undefined as unknown,
      followupProvider: undefined as unknown,
      dispose: vi.fn(),
    }
    ;(chat.createChatParticipant as ReturnType<typeof vi.fn>).mockReturnValue(mockParticipant)
    const extCtx = makeExtensionContext()
    registerChatParticipant(extCtx as never, () => undefined)
    expect(mockParticipant.followupProvider).toBeDefined()
  })
})

describe('no AAHP context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows warning when no context is available', async () => {
    const handler = getChatHandler(() => undefined)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(), makeChatContext(), stream, token)
    expect(stream.markdown).toHaveBeenCalledTimes(1)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('No `.ai/handoff/MANIFEST.json` found')
  })
})

describe('/help command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists all available commands', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('help'), makeChatContext(), stream, token)
    expect(stream.markdown).toHaveBeenCalledTimes(1)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('/help')
    expect(msg).toContain('/status')
    expect(msg).toContain('/tasks')
    expect(msg).toContain('/next')
    expect(msg).toContain('/context')
    expect(msg).toContain('/phase')
    expect(msg).toContain('/done')
  })
})

describe('/status command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows project name and phase', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('test-project')
    expect(msg).toContain('implementation')
  })

  it('shows version info', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('AAHP v3')
  })

  it('shows last agent and commit', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('claude-code')
    expect(msg).toContain('abc1234')
  })

  it('shows active task when one exists', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Build feature', status: 'in_progress' }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-001')
    expect(msg).toContain('Build feature')
  })

  it('shows no active task when none exist', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('- none -')
  })

  it('shows quick context', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('A test project for unit testing')
  })

  it('falls back to version key when aahp_version is missing', async () => {
    const ctx = makeContext({
      manifest: makeManifest({ aahp_version: undefined as unknown as string, version: '2.5' }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('status'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('AAHP v2.5')
  })
})

describe('/tasks command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "no tasks" when tasks are undefined', async () => {
    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('No tasks defined')
  })

  it('shows "no tasks" when tasks object is empty', async () => {
    const ctx = makeContext({ manifest: makeManifest({ tasks: {} }) })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('No tasks defined')
  })

  it('renders all tasks in a table', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'First task', status: 'done', priority: 'high' }),
          'T-002': makeTask({ title: 'Second task', status: 'ready', priority: 'medium' }),
        },
        next_task_id: 3,
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-001')
    expect(msg).toContain('T-002')
    expect(msg).toContain('First task')
    expect(msg).toContain('Second task')
    expect(msg).toContain('done')
    expect(msg).toContain('ready')
  })

  it('shows status icons for each task', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ status: 'done' }),
          'T-002': makeTask({ status: 'in_progress' }),
          'T-003': makeTask({ status: 'ready' }),
          'T-004': makeTask({ status: 'blocked' }),
          'T-005': makeTask({ status: 'pending' }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    // Each status icon appears once per task
    expect(msg).toContain('✅')
    expect(msg).toContain('🔄')
    expect(msg).toContain('⏳')
    expect(msg).toContain('🚫')
    expect(msg).toContain('💤')
  })

  it('shows depends_on for each task', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'First', depends_on: [] }),
          'T-002': makeTask({ title: 'Second', depends_on: ['T-001'] }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-001')
    expect(msg).toContain('-') // no deps shows -
  })

  it('shows next_task_id', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: { 'T-001': makeTask() },
        next_task_id: 5,
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('tasks'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-005')
  })
})

describe('/next command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows in-progress task when one exists', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Active work', status: 'in_progress' }),
          'T-002': makeTask({ title: 'Ready work', status: 'ready' }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('next'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Already in progress')
    expect(msg).toContain('T-001')
    expect(msg).toContain('Active work')
  })

  it('shows ready tasks when no in-progress', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Done task', status: 'done' }),
          'T-002': makeTask({ title: 'Ready one', status: 'ready', priority: 'high' }),
          'T-003': makeTask({ title: 'Ready two', status: 'ready', priority: 'low' }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('next'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Ready to start')
    expect(msg).toContain('T-002')
    expect(msg).toContain('T-003')
    expect(msg).toContain('high priority')
    expect(msg).toContain('low priority')
  })

  it('shows blocked tasks when nothing is ready', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Done', status: 'done' }),
          'T-002': makeTask({ title: 'Blocked one', status: 'blocked', depends_on: ['T-099'] }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('next'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('blocked')
    expect(msg).toContain('T-002')
    expect(msg).toContain('T-099')
  })

  it('shows all-done message when no tasks remain', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ status: 'done' }),
        },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('next'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('All tasks are done')
  })

  it('shows all-done when tasks object is empty', async () => {
    const ctx = makeContext({ manifest: makeManifest({ tasks: {} }) })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('next'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('All tasks are done')
  })
})

describe('/context command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the injected system prompt in a code block', async () => {
    const ctx = makeContext()
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('context'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Injected System Prompt')
    expect(msg).toContain('```')
    expect(msg).toContain('test-project')
  })

  it('shows character count', async () => {
    const ctx = makeContext()
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('context'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toMatch(/\d+ characters/)
  })
})

describe('/phase command', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-phase-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('shows current phase when no argument', async () => {
    const handler = getChatHandler(() => makeContext({ handoffDir: tmpDir }))
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('phase', ''), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('implementation')
    expect(msg).toContain('Available phases')
    expect(msg).toContain('research')
    expect(msg).toContain('release')
  })

  it('updates phase to valid value', async () => {
    const handler = getChatHandler(() => makeContext({ handoffDir: tmpDir }))
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('phase', 'review'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Phase updated')
    expect(msg).toContain('implementation')
    expect(msg).toContain('review')
    // Verify manifest was actually written to disk
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'MANIFEST.json'), 'utf8'))
    expect(written.last_session.phase).toBe('review')
  })

  it('rejects invalid phase', async () => {
    const handler = getChatHandler(() => makeContext({ handoffDir: tmpDir }))
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('phase', 'invalid-phase'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Unknown phase')
    expect(msg).toContain('invalid-phase')
  })

  it('accepts phase with mixed case', async () => {
    const handler = getChatHandler(() => makeContext({ handoffDir: tmpDir }))
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('phase', 'Release'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Phase updated')
    expect(msg).toContain('release')
  })
})

describe('/done command', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-done-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('shows usage when no task ID provided', async () => {
    const ctx = makeContext({
      manifest: makeManifest({ tasks: { 'T-001': makeTask() } }),
      handoffDir: tmpDir,
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('done', ''), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('Usage')
    expect(msg).toContain('@aahp /done T-003')
  })

  it('marks task as done and saves', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Complete me', status: 'ready' }),
        },
      }),
      handoffDir: tmpDir,
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('done', 'T-001'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-001')
    expect(msg).toContain('Complete me')
    expect(msg).toContain('done')
    // Verify manifest was written with task marked done
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, 'MANIFEST.json'), 'utf8'))
    expect(written.tasks['T-001'].status).toBe('done')
    expect(written.tasks['T-001'].completed).toBeDefined()
  })

  it('shows error when task does not exist', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: { 'T-001': makeTask() },
      }),
      handoffDir: tmpDir,
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('done', 'T-999'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('not found')
    expect(msg).toContain('T-999')
    expect(msg).toContain('T-001') // shows available tasks
  })

  it('normalizes task ID to uppercase', async () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: { 'T-001': makeTask({ title: 'Fix bug' }) },
      }),
      handoffDir: tmpDir,
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest('done', 't-001'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('T-001')
    expect(msg).toContain('Fix bug')
    expect(msg).toContain('done')
  })
})

describe('free-form (AI-powered) requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows warning when no language model is available', async () => {
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no models'))
    const ctx = makeContext()
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'help me implement this'), makeChatContext(), stream, token)
    const msg = stream.markdown.mock.calls[0]![0] as string
    expect(msg).toContain('No language model available')
    expect(msg).toContain('AAHP Context loaded')
  })

  it('shows top task before streaming response', async () => {
    const mockResponse = {
      text: (async function* () { yield 'response chunk' })(),
    }
    const mockModel = { sendRequest: vi.fn().mockResolvedValue(mockResponse) }
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockResolvedValue([mockModel])

    const ctx = makeContext({
      manifest: makeManifest({
        tasks: { 'T-001': makeTask({ title: 'Current work', status: 'in_progress' }) },
      }),
    })
    const handler = getChatHandler(() => ctx)
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'what should I do?'), makeChatContext(), stream, token)
    const firstCall = stream.markdown.mock.calls[0]![0] as string
    expect(firstCall).toContain('T-001')
    expect(firstCall).toContain('Current work')
  })

  it('streams LM response chunks to markdown', async () => {
    const mockResponse = {
      text: (async function* () {
        yield 'Hello '
        yield 'World'
      })(),
    }
    const mockModel = { sendRequest: vi.fn().mockResolvedValue(mockResponse) }
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockResolvedValue([mockModel])

    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'greet me'), makeChatContext(), stream, token)

    const calls = stream.markdown.mock.calls.map((c: unknown[]) => c[0])
    expect(calls).toContain('Hello ')
    expect(calls).toContain('World')
  })

  it('handles LanguageModelError gracefully', async () => {
    const mockModel = {
      sendRequest: vi.fn().mockRejectedValue(new LanguageModelError('rate limited', '429')),
    }
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockResolvedValue([mockModel])

    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'do something'), makeChatContext(), stream, token)
    const calls = stream.markdown.mock.calls.map((c: unknown[]) => c[0])
    const errorMsg = calls.find((c: string) => c.includes('LM error'))
    expect(errorMsg).toBeDefined()
    expect(errorMsg).toContain('rate limited')
    expect(errorMsg).toContain('429')
  })

  it('rethrows non-LanguageModelError errors', async () => {
    const mockModel = {
      sendRequest: vi.fn().mockRejectedValue(new TypeError('unexpected')),
    }
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockResolvedValue([mockModel])

    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await expect(
      handler(makeRequest(undefined, 'do something'), makeChatContext(), stream, token),
    ).rejects.toThrow('unexpected')
  })

  it('includes chat history in messages sent to model', async () => {
    const mockResponse = {
      text: (async function* () { yield 'ok' })(),
    }
    const mockModel = { sendRequest: vi.fn().mockResolvedValue(mockResponse) }
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockResolvedValue([mockModel])

    const history = [
      new ChatRequestTurn('previous question'),
      new ChatResponseTurn([
        new ChatResponseMarkdownPart({ value: 'previous answer' }),
      ]),
    ]

    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'new question'), { history }, stream, token)

    const messages = mockModel.sendRequest.mock.calls[0]![0] as Array<{
      role: string
      content: string
    }>
    // System prompt + history request + history response + user message = 4
    expect(messages.length).toBe(4)
  })

  it('falls back to any available model when copilot model fails', async () => {
    const mockResponse = {
      text: (async function* () { yield 'fallback response' })(),
    }
    const mockModel = { sendRequest: vi.fn().mockResolvedValue(mockResponse) }

    let callCount = 0
    ;(lm.selectChatModels as ReturnType<typeof vi.fn>).mockImplementation(async (opts?: { vendor?: string }) => {
      callCount++
      if (opts?.vendor === 'copilot') throw new Error('no copilot')
      return [mockModel]
    })

    const handler = getChatHandler(() => makeContext())
    const stream = makeStream()
    const token = new CancellationTokenSource().token
    await handler(makeRequest(undefined, 'test'), makeChatContext(), stream, token)

    expect(callCount).toBe(2) // first copilot attempt, then fallback
    expect(mockModel.sendRequest).toHaveBeenCalled()
  })
})

describe('followup provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function getFollowupProvider(getCtx: () => AahpContext | undefined): {
    provideFollowups: (
      result: unknown,
      context: unknown,
      token: unknown,
    ) => Array<{ prompt: string; label: string }>
  } {
    const mockParticipant = {
      iconPath: undefined as unknown,
      followupProvider: undefined as {
        provideFollowups: (
          result: unknown,
          context: unknown,
          token: unknown,
        ) => Array<{ prompt: string; label: string }>
      } | undefined,
      dispose: vi.fn(),
    }
    ;(chat.createChatParticipant as ReturnType<typeof vi.fn>).mockReturnValue(mockParticipant)
    const extCtx = makeExtensionContext()
    registerChatParticipant(extCtx as never, getCtx)
    return mockParticipant.followupProvider!
  }

  it('returns empty followups when no context', () => {
    const provider = getFollowupProvider(() => undefined)
    const token = new CancellationTokenSource().token
    const followups = provider.provideFollowups({}, {}, token)
    expect(followups).toEqual([])
  })

  it('returns standard followups when context exists', () => {
    const provider = getFollowupProvider(() => makeContext())
    const token = new CancellationTokenSource().token
    const followups = provider.provideFollowups({}, {}, token)
    expect(followups.length).toBeGreaterThanOrEqual(2)
    const labels = followups.map(f => f.label)
    expect(labels.some(l => l.includes('Update manifest'))).toBe(true)
    expect(labels.some(l => l.includes('What next'))).toBe(true)
  })

  it('includes complete-task followup when top task exists', () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: { 'T-005': makeTask({ title: 'Test thing', status: 'in_progress' }) },
      }),
    })
    const provider = getFollowupProvider(() => ctx)
    const token = new CancellationTokenSource().token
    const followups = provider.provideFollowups({}, {}, token)
    const completeFollowup = followups.find(f => f.label.includes('Complete T-005'))
    expect(completeFollowup).toBeDefined()
    expect(completeFollowup!.prompt).toContain('T-005')
  })

  it('does not include complete-task when no top task', () => {
    const ctx = makeContext({ manifest: makeManifest({ tasks: { 'T-001': makeTask({ status: 'done' }) } }) })
    const provider = getFollowupProvider(() => ctx)
    const token = new CancellationTokenSource().token
    const followups = provider.provideFollowups({}, {}, token)
    const completeFollowup = followups.find(f => f.label.includes('Complete'))
    expect(completeFollowup).toBeUndefined()
  })
})
