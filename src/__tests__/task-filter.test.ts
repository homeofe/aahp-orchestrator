import { describe, it, expect } from 'vitest'
import {
  flattenAllTasks,
  applyFilters,
  sortByPriorityThenAge,
  filterAndSortTasks,
  getRepoNames,
  DEFAULT_FILTER,
  TaskFilter,
} from '../task-filter'
import { AahpManifest, RepoOverview } from '../aahp-reader'
import { FlatTask } from '../task-tree'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(tasks?: AahpManifest['tasks']): AahpManifest {
  return {
    aahp_version: '3.0',
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
    tasks,
  }
}

function makeOverview(name: string, tasks?: AahpManifest['tasks']): RepoOverview {
  const manifest = makeManifest(tasks)
  const taskEntries = Object.values(tasks ?? {})
  return {
    repoPath: `/repos/${name}`,
    repoName: name,
    manifest,
    handoffDir: `/repos/${name}/.ai/handoff`,
    hasManifest: true,
    taskCounts: {
      total: taskEntries.length,
      ready: taskEntries.filter(t => t.status === 'ready').length,
      inProgress: taskEntries.filter(t => t.status === 'in_progress').length,
      done: taskEntries.filter(t => t.status === 'done').length,
      blocked: taskEntries.filter(t => t.status === 'blocked').length,
      pending: taskEntries.filter(t => t.status === 'pending').length,
    },
    lastActivity: '2026-02-27T10:00:00Z',
    health: 'healthy',
    nextActions: [],
  }
}

function makeFlatTask(
  repoName: string,
  taskId: string,
  opts: Partial<FlatTask['task']> = {},
): FlatTask {
  return {
    repoPath: `/repos/${repoName}`,
    repoName,
    taskId,
    task: {
      title: opts.title ?? `Task ${taskId}`,
      status: opts.status ?? 'ready',
      priority: opts.priority ?? 'medium',
      depends_on: opts.depends_on ?? [],
      created: opts.created ?? '2026-02-01T10:00:00Z',
      ...opts,
    },
  }
}

// ── flattenAllTasks ──────────────────────────────────────────────────────────

describe('flattenAllTasks', () => {
  it('returns empty array for no overviews', () => {
    expect(flattenAllTasks([])).toEqual([])
  })

  it('returns empty array for repos with no tasks', () => {
    expect(flattenAllTasks([makeOverview('repo-a')])).toEqual([])
  })

  it('includes done tasks (unlike flattenOpenTasks)', () => {
    const overviews = [makeOverview('repo-a', {
      'T-001': { title: 'Done task', status: 'done', priority: 'high', depends_on: [], created: '2026-02-01T10:00:00Z', completed: '2026-02-02T10:00:00Z' },
      'T-002': { title: 'Open task', status: 'ready', priority: 'medium', depends_on: [], created: '2026-02-01T10:00:00Z' },
    })]
    const result = flattenAllTasks(overviews)
    expect(result).toHaveLength(2)
  })

  it('flattens tasks from multiple repos', () => {
    const overviews = [
      makeOverview('repo-a', {
        'T-001': { title: 'A1', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-01T10:00:00Z' },
      }),
      makeOverview('repo-b', {
        'T-001': { title: 'B1', status: 'blocked', priority: 'low', depends_on: [], created: '2026-02-01T10:00:00Z' },
        'T-002': { title: 'B2', status: 'in_progress', priority: 'medium', depends_on: [], created: '2026-02-01T10:00:00Z' },
      }),
    ]
    const result = flattenAllTasks(overviews)
    expect(result).toHaveLength(3)
    expect(result.map(t => t.repoName)).toContain('repo-a')
    expect(result.map(t => t.repoName)).toContain('repo-b')
  })
})

// ── applyFilters ─────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const tasks: FlatTask[] = [
    makeFlatTask('repo-a', 'T-001', { status: 'ready', priority: 'high' }),
    makeFlatTask('repo-a', 'T-002', { status: 'done', priority: 'low' }),
    makeFlatTask('repo-b', 'T-003', { status: 'blocked', priority: 'medium' }),
    makeFlatTask('repo-b', 'T-004', { status: 'in_progress', priority: 'high' }),
    makeFlatTask('repo-c', 'T-005', { status: 'pending', priority: 'low' }),
  ]

  it('returns all tasks when all filters are "all"', () => {
    const result = applyFilters(tasks, DEFAULT_FILTER)
    expect(result).toHaveLength(5)
  })

  it('filters by status', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'ready' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-001')
  })

  it('filters by status: done', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'done' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-002')
  })

  it('filters by status: blocked', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'blocked' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-003')
  })

  it('filters by status: in_progress', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'in_progress' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-004')
  })

  it('filters by status: pending', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'pending' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-005')
  })

  it('filters by priority', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, priority: 'high' })
    expect(result).toHaveLength(2)
    expect(result.map(t => t.taskId).sort()).toEqual(['T-001', 'T-004'])
  })

  it('filters by priority: low', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, priority: 'low' })
    expect(result).toHaveLength(2)
    expect(result.map(t => t.taskId).sort()).toEqual(['T-002', 'T-005'])
  })

  it('filters by repo', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, repo: 'repo-b' })
    expect(result).toHaveLength(2)
    expect(result.every(t => t.repoName === 'repo-b')).toBe(true)
  })

  it('combines multiple filters', () => {
    const result = applyFilters(tasks, { status: 'ready', priority: 'high', repo: 'repo-a' })
    expect(result).toHaveLength(1)
    expect(result[0].taskId).toBe('T-001')
  })

  it('returns empty when no tasks match combined filters', () => {
    const result = applyFilters(tasks, { status: 'done', priority: 'high', repo: 'repo-a' })
    expect(result).toHaveLength(0)
  })

  it('returns empty for unknown status', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, status: 'nonexistent' })
    expect(result).toHaveLength(0)
  })

  it('returns empty for unknown repo', () => {
    const result = applyFilters(tasks, { ...DEFAULT_FILTER, repo: 'no-such-repo' })
    expect(result).toHaveLength(0)
  })
})

// ── sortByPriorityThenAge ────────────────────────────────────────────────────

describe('sortByPriorityThenAge', () => {
  it('returns empty array for empty input', () => {
    expect(sortByPriorityThenAge([])).toEqual([])
  })

  it('sorts by priority: high > medium > low', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-001', { priority: 'low', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-002', { priority: 'high', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-003', { priority: 'medium', created: '2026-02-01T10:00:00Z' }),
    ]
    const sorted = sortByPriorityThenAge(tasks)
    expect(sorted.map(t => t.task.priority)).toEqual(['high', 'medium', 'low'])
  })

  it('sorts by age within same priority (oldest first)', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-001', { priority: 'high', created: '2026-02-15T10:00:00Z' }),
      makeFlatTask('a', 'T-002', { priority: 'high', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-003', { priority: 'high', created: '2026-02-10T10:00:00Z' }),
    ]
    const sorted = sortByPriorityThenAge(tasks)
    expect(sorted.map(t => t.taskId)).toEqual(['T-002', 'T-003', 'T-001'])
  })

  it('falls back to task ID when priority and age are equal', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-003', { priority: 'medium', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-001', { priority: 'medium', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-002', { priority: 'medium', created: '2026-02-01T10:00:00Z' }),
    ]
    const sorted = sortByPriorityThenAge(tasks)
    expect(sorted.map(t => t.taskId)).toEqual(['T-001', 'T-002', 'T-003'])
  })

  it('does not mutate the original array', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-002', { priority: 'low' }),
      makeFlatTask('a', 'T-001', { priority: 'high' }),
    ]
    const original = [...tasks]
    sortByPriorityThenAge(tasks)
    expect(tasks.map(t => t.taskId)).toEqual(original.map(t => t.taskId))
  })

  it('handles missing created dates gracefully', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-001', { priority: 'high', created: '' }),
      makeFlatTask('a', 'T-002', { priority: 'high', created: '2026-02-01T10:00:00Z' }),
    ]
    const sorted = sortByPriorityThenAge(tasks)
    // Empty date treated as epoch 0 (oldest), so T-001 comes first
    expect(sorted.map(t => t.taskId)).toEqual(['T-001', 'T-002'])
  })

  it('combined priority and age sorting', () => {
    const tasks: FlatTask[] = [
      makeFlatTask('a', 'T-001', { priority: 'low', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-002', { priority: 'high', created: '2026-02-15T10:00:00Z' }),
      makeFlatTask('a', 'T-003', { priority: 'high', created: '2026-02-01T10:00:00Z' }),
      makeFlatTask('a', 'T-004', { priority: 'medium', created: '2026-02-10T10:00:00Z' }),
      makeFlatTask('a', 'T-005', { priority: 'medium', created: '2026-02-05T10:00:00Z' }),
    ]
    const sorted = sortByPriorityThenAge(tasks)
    expect(sorted.map(t => t.taskId)).toEqual(['T-003', 'T-002', 'T-005', 'T-004', 'T-001'])
  })
})

// ── filterAndSortTasks ───────────────────────────────────────────────────────

describe('filterAndSortTasks', () => {
  it('returns empty for no overviews', () => {
    expect(filterAndSortTasks([], DEFAULT_FILTER)).toEqual([])
  })

  it('returns all tasks sorted when filter is default', () => {
    const overviews = [makeOverview('repo-a', {
      'T-001': { title: 'Low old', status: 'ready', priority: 'low', depends_on: [], created: '2026-01-01T10:00:00Z' },
      'T-002': { title: 'High new', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-15T10:00:00Z' },
      'T-003': { title: 'High old', status: 'done', priority: 'high', depends_on: [], created: '2026-01-15T10:00:00Z', completed: '2026-02-01T10:00:00Z' },
    })]
    const result = filterAndSortTasks(overviews, DEFAULT_FILTER)
    expect(result).toHaveLength(3)
    // high tasks first (T-003 older than T-002), then low
    expect(result.map(t => t.taskId)).toEqual(['T-003', 'T-002', 'T-001'])
  })

  it('filters and sorts together', () => {
    const overviews = [
      makeOverview('repo-a', {
        'T-001': { title: 'A high ready', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-10T10:00:00Z' },
        'T-002': { title: 'A low done', status: 'done', priority: 'low', depends_on: [], created: '2026-01-01T10:00:00Z' },
      }),
      makeOverview('repo-b', {
        'T-003': { title: 'B high ready', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-01T10:00:00Z' },
        'T-004': { title: 'B med ready', status: 'ready', priority: 'medium', depends_on: [], created: '2026-02-05T10:00:00Z' },
      }),
    ]

    // Filter: ready only
    const result = filterAndSortTasks(overviews, { status: 'ready', priority: 'all', repo: 'all' })
    expect(result).toHaveLength(3)
    // high: T-003 (older) then T-001, then medium: T-004
    expect(result.map(t => t.taskId)).toEqual(['T-003', 'T-001', 'T-004'])
  })

  it('filters by repo and sorts', () => {
    const overviews = [
      makeOverview('repo-a', {
        'T-001': { title: 'A1', status: 'ready', priority: 'low', depends_on: [], created: '2026-02-01T10:00:00Z' },
      }),
      makeOverview('repo-b', {
        'T-002': { title: 'B1', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-01T10:00:00Z' },
        'T-003': { title: 'B2', status: 'ready', priority: 'medium', depends_on: [], created: '2026-02-01T10:00:00Z' },
      }),
    ]
    const result = filterAndSortTasks(overviews, { status: 'all', priority: 'all', repo: 'repo-b' })
    expect(result).toHaveLength(2)
    expect(result.map(t => t.taskId)).toEqual(['T-002', 'T-003'])
  })
})

// ── getRepoNames ─────────────────────────────────────────────────────────────

describe('getRepoNames', () => {
  it('returns empty for no overviews', () => {
    expect(getRepoNames([])).toEqual([])
  })

  it('returns sorted repo names', () => {
    const overviews = [
      makeOverview('zeta'),
      makeOverview('alpha'),
      makeOverview('gamma'),
    ]
    expect(getRepoNames(overviews)).toEqual(['alpha', 'gamma', 'zeta'])
  })

  it('returns single repo name', () => {
    expect(getRepoNames([makeOverview('solo')])).toEqual(['solo'])
  })
})
