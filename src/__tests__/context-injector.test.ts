import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerContextInjector } from '../context-injector'
import { AahpContext, AahpManifest } from '../aahp-reader'
import { commands, env, window } from 'vscode'

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
  workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
} {
  return {
    subscriptions: [],
    workspaceState: {
      get: vi.fn(() => undefined),
      update: vi.fn(),
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerContextInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an array of disposables', () => {
    const extCtx = makeExtensionContext()
    const disposables = registerContextInjector(extCtx as never, () => undefined)
    expect(Array.isArray(disposables)).toBe(true)
    expect(disposables.length).toBeGreaterThan(0)
  })

  it('registers the aahp.copyContext command', () => {
    const extCtx = makeExtensionContext()
    registerContextInjector(extCtx as never, () => undefined)
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'aahp.copyContext',
      expect.any(Function),
    )
  })

  it('registers an onDidChangeActiveTextEditor listener', () => {
    const extCtx = makeExtensionContext()
    registerContextInjector(extCtx as never, () => undefined)
    expect(window.onDidChangeActiveTextEditor).toHaveBeenCalledWith(expect.any(Function))
  })
})

describe('aahp.copyContext command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function getCopyCommandHandler(getCtx: () => AahpContext | undefined): (...args: unknown[]) => unknown {
    const extCtx = makeExtensionContext()
    registerContextInjector(extCtx as never, getCtx)
    const call = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === 'aahp.copyContext',
    )
    return call![1] as (...args: unknown[]) => unknown
  }

  it('shows warning when no AAHP context is available', async () => {
    const handler = getCopyCommandHandler(() => undefined)
    await handler()
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'AAHP: No MANIFEST.json found in workspace.',
    )
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies system prompt to clipboard when context is available', async () => {
    const ctx = makeContext()
    const handler = getCopyCommandHandler(() => ctx)
    await handler()
    expect(env.clipboard.writeText).toHaveBeenCalledTimes(1)
    const written = (env.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(written).toContain('test-project')
    expect(written).toContain('implementation')
  })

  it('shows information message with character count after copy', async () => {
    const ctx = makeContext()
    const handler = getCopyCommandHandler(() => ctx)
    await handler()
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1)
    const msg = (window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(msg).toContain('AAHP context copied to clipboard')
    expect(msg).toMatch(/\d+ chars/)
  })
})

describe('context banner notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function getEditorChangeListener(
    getCtx: () => AahpContext | undefined,
    extCtx?: ReturnType<typeof makeExtensionContext>,
  ): (editor: unknown) => void {
    const ctx = extCtx ?? makeExtensionContext()
    registerContextInjector(ctx as never, getCtx)
    const call = (window.onDidChangeActiveTextEditor as ReturnType<typeof vi.fn>).mock.calls[0]
    return call![0] as (editor: unknown) => void
  }

  it('does not show banner when context was already shown', () => {
    const extCtx = makeExtensionContext()
    extCtx.workspaceState.get.mockReturnValue(true)
    const listener = getEditorChangeListener(() => makeContext(), extCtx)
    listener({})
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it('does not show banner when no AAHP context', () => {
    const listener = getEditorChangeListener(() => undefined)
    listener({})
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it('shows banner with project info on first editor change', () => {
    const ctx = makeContext()
    const extCtx = makeExtensionContext()
    ;(window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const listener = getEditorChangeListener(() => ctx, extCtx)
    listener({})
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('AAHP'),
      'Copy Context',
      'Open Dashboard',
    )
  })

  it('banner message includes phase and project', () => {
    const ctx = makeContext()
    const extCtx = makeExtensionContext()
    ;(window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const listener = getEditorChangeListener(() => ctx, extCtx)
    listener({})
    const msg = (window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(msg).toContain('implementation')
    expect(msg).toContain('test-project')
  })

  it('marks banner as shown in workspace state', () => {
    const ctx = makeContext()
    const extCtx = makeExtensionContext()
    ;(window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const listener = getEditorChangeListener(() => ctx, extCtx)
    listener({})
    expect(extCtx.workspaceState.update).toHaveBeenCalledWith(
      'aahp.contextBannerShown',
      true,
    )
  })

  it('executes aahp.copyContext when user clicks Copy Context', async () => {
    const ctx = makeContext()
    const extCtx = makeExtensionContext()
    ;(window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Copy Context')
    const listener = getEditorChangeListener(() => ctx, extCtx)
    listener({})
    // Wait for the promise chain to resolve
    await vi.waitFor(() => {
      expect(commands.executeCommand).toHaveBeenCalledWith('aahp.copyContext')
    })
  })

  it('executes aahp.openDashboard when user clicks Open Dashboard', async () => {
    const ctx = makeContext()
    const extCtx = makeExtensionContext()
    ;(window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Open Dashboard')
    const listener = getEditorChangeListener(() => ctx, extCtx)
    listener({})
    await vi.waitFor(() => {
      expect(commands.executeCommand).toHaveBeenCalledWith('aahp.openDashboard')
    })
  })
})
