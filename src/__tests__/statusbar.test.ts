import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStatusBar, updateStatusBar } from '../statusbar'
import { AahpContext, AahpManifest } from '../aahp-reader'
import { window, StatusBarAlignment } from 'vscode'

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createStatusBar', () => {
  it('creates a status bar item with left alignment', () => {
    const item = createStatusBar()
    expect(window.createStatusBarItem).toHaveBeenCalledWith(StatusBarAlignment.Left, 10)
    expect(item.command).toBe('aahp.openDashboard')
  })
})

describe('updateStatusBar', () => {
  it('shows inactive state when no context', () => {
    const item = createStatusBar()
    updateStatusBar(item, undefined)
    expect(item.text).toBe('$(circle-slash) AAHP')
    expect(item.tooltip).toBe('No .ai/handoff/MANIFEST.json found in workspace')
    expect(item.show).toHaveBeenCalled()
  })

  it('shows project phase when context is available', () => {
    const item = createStatusBar()
    const ctx = makeContext()
    updateStatusBar(item, ctx)
    expect(item.text).toContain('$(robot) AAHP [implementation]')
    expect(item.show).toHaveBeenCalled()
  })

  it('includes top task label in text', () => {
    const item = createStatusBar()
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': {
            title: 'Add automated tests',
            status: 'in_progress',
            priority: 'high',
            depends_on: [],
            created: '2026-02-27T10:00:00Z',
          },
        },
      }),
    })
    updateStatusBar(item, ctx)
    expect(item.text).toContain('T-001')
    expect(item.text).toContain('Add automated tests')
  })
})
