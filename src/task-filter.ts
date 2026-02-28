import { RepoOverview } from './aahp-reader'
import { FlatTask } from './task-tree'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskFilter {
  status: string   // 'all' | 'ready' | 'in_progress' | 'done' | 'blocked' | 'pending'
  priority: string // 'all' | 'high' | 'medium' | 'low'
  repo: string     // 'all' | repo name
}

export const DEFAULT_FILTER: TaskFilter = { status: 'all', priority: 'all', repo: 'all' }

// ── Pure functions ───────────────────────────────────────────────────────────

/** Flatten all tasks from all repos into FlatTask[], including done tasks. */
export function flattenAllTasks(overviews: RepoOverview[]): FlatTask[] {
  const result: FlatTask[] = []
  for (const repo of overviews) {
    const tasks = repo.manifest.tasks ?? {}
    for (const [id, task] of Object.entries(tasks)) {
      result.push({
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        taskId: id,
        task,
      })
    }
  }
  return result
}

/** Apply status, priority, and repo filters to a list of tasks. */
export function applyFilters(tasks: FlatTask[], filter: TaskFilter): FlatTask[] {
  return tasks.filter(t => {
    if (filter.status !== 'all' && t.task.status !== filter.status) return false
    if (filter.priority !== 'all' && t.task.priority !== filter.priority) return false
    if (filter.repo !== 'all' && t.repoName !== filter.repo) return false
    return true
  })
}

/** Sort tasks by priority (high > medium > low) then by age (oldest first). */
export function sortByPriorityThenAge(tasks: FlatTask[]): FlatTask[] {
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

  return [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.task.priority] ?? 9
    const pb = priorityOrder[b.task.priority] ?? 9
    if (pa !== pb) return pa - pb

    // Older tasks first (ascending by created date)
    const dateA = a.task.created ? new Date(a.task.created).getTime() : 0
    const dateB = b.task.created ? new Date(b.task.created).getTime() : 0
    if (dateA !== dateB) return dateA - dateB

    return a.taskId.localeCompare(b.taskId)
  })
}

/** Filter and sort in one call - convenience wrapper. */
export function filterAndSortTasks(
  overviews: RepoOverview[],
  filter: TaskFilter,
): FlatTask[] {
  const all = flattenAllTasks(overviews)
  const filtered = applyFilters(all, filter)
  return sortByPriorityThenAge(filtered)
}

/** Extract unique repo names from overviews, sorted alphabetically. */
export function getRepoNames(overviews: RepoOverview[]): string[] {
  return overviews.map(r => r.repoName).sort((a, b) => a.localeCompare(b))
}
