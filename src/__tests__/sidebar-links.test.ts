import { describe, it, expect } from 'vitest'
import { AahpDashboardProvider } from '../sidebar'
import { AahpManifest, RepoOverview } from '../aahp-reader'

function makeManifest(): AahpManifest {
  return {
    aahp_version: '3.0',
    project: 'AAHP',
    last_session: {
      agent: 'claude-code',
      timestamp: '2026-03-01T10:00:00Z',
      commit: 'abc1234',
      phase: 'implementation',
      duration_minutes: 5,
    },
    files: {},
    quick_context: 'T-006 npm publish blocked on auth',
    token_budget: {
      manifest_only: 85,
      full_read: 5614,
    },
    next_task_id: 12,
    tasks: {
      'T-006': {
        title: 'Publish npm package',
        status: 'blocked',
        priority: 'low',
        depends_on: [],
        created: '2026-02-26T20:49:00Z',
        github_issue: 2,
        github_repo: 'homeofe/AAHP',
      },
    },
  }
}

function makeOverview(): RepoOverview {
  return {
    repoPath: '/dev/AAHP',
    repoName: 'AAHP',
    manifest: makeManifest(),
    handoffDir: '/dev/AAHP/.ai/handoff',
    hasManifest: true,
    taskCounts: {
      total: 1,
      ready: 0,
      inProgress: 0,
      done: 0,
      blocked: 1,
      pending: 0,
    },
    lastActivity: '2026-03-01T10:00:00Z',
    health: 'healthy',
    nextActions: [
      {
        section: 'blocked',
        taskId: 'T-006',
        title: 'Publish npm package',
      },
    ],
    githubUrl: 'https://github.com/homeofe/AAHP',
  }
}

describe('Dashboard GitHub links', () => {
  it('renders direct issue URL for mapped Next Steps task', () => {
    const provider = new AahpDashboardProvider({} as any)
    provider.updateRepoOverviews([makeOverview()])

    const html = (provider as any)._getHtml({} as any) as string

    expect(html).toContain('https://github.com/homeofe/AAHP/issues/2')
    expect(html).not.toContain('https://github.com/homeofe/AAHP/issues?q=T-006')
    expect(html).toContain('[T-006]')
    expect(html).not.toContain('[T-011]')
  })
})
