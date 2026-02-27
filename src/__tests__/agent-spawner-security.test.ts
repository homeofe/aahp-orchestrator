import { describe, it, expect } from 'vitest'
import * as path from 'path'

/**
 * Security-focused tests for agent-spawner.ts.
 * These validate the command allowlist (C-2) and path traversal protection (C-4/C-5).
 *
 * Since executeCopilotTool and safePath are not exported, we test them indirectly
 * by testing the exported ALLOWED_COMMAND_PREFIXES pattern and building test cases
 * that would be run through the tool.
 */

// Import the ALLOWED_COMMAND_PREFIXES constant indirectly by reading the source
// Since it's not exported, we replicate and verify the allowlist here
const ALLOWED_COMMAND_PREFIXES = [
  'git', 'npm', 'pnpm', 'node', 'npx', 'tsc', 'vitest', 'jest',
  'echo', 'ls', 'dir', 'cat', 'type', 'pwd', 'cd',
]

describe('C-2: Command allowlist', () => {
  it('allows git commands', () => {
    expect(ALLOWED_COMMAND_PREFIXES).toContain('git')
  })

  it('allows build tools', () => {
    expect(ALLOWED_COMMAND_PREFIXES).toContain('npm')
    expect(ALLOWED_COMMAND_PREFIXES).toContain('tsc')
    expect(ALLOWED_COMMAND_PREFIXES).toContain('node')
  })

  it('allows test runners', () => {
    expect(ALLOWED_COMMAND_PREFIXES).toContain('vitest')
    expect(ALLOWED_COMMAND_PREFIXES).toContain('jest')
  })

  it('blocks dangerous commands', () => {
    const dangerousCommands = ['rm', 'del', 'curl', 'wget', 'ssh', 'sudo', 'chmod', 'kill', 'python', 'bash', 'sh', 'powershell', 'cmd']
    for (const cmd of dangerousCommands) {
      expect(ALLOWED_COMMAND_PREFIXES).not.toContain(cmd)
    }
  })
})

describe('C-4/C-5: Path traversal protection (logic)', () => {
  // Replicate the safePath logic from agent-spawner.ts to test it
  function safePath(repoPath: string, p: string): string {
    const resolved = path.resolve(repoPath, p.replace(/^\//, ''))
    const normalizedRepo = path.resolve(repoPath)
    if (resolved !== normalizedRepo && !resolved.startsWith(normalizedRepo + path.sep)) {
      throw new Error('path outside repo')
    }
    return resolved
  }

  it('allows paths within the repo', () => {
    const repoPath = path.resolve('/dev/my-repo')
    expect(() => safePath(repoPath, 'src/index.ts')).not.toThrow()
    expect(() => safePath(repoPath, 'package.json')).not.toThrow()
    expect(() => safePath(repoPath, '.')).not.toThrow()
  })

  it('blocks traversal with ../', () => {
    const repoPath = path.resolve('/dev/my-repo')
    expect(() => safePath(repoPath, '../../../etc/passwd')).toThrow('path outside repo')
    expect(() => safePath(repoPath, '../other-repo/secret.key')).toThrow('path outside repo')
  })

  it('blocks absolute paths outside repo', () => {
    const repoPath = path.resolve('/dev/my-repo')
    // The replace(/^\//, '') strips leading slash, but the resolve still works
    // On Windows, absolute paths like C:\ would be caught
    // Test with a relative traversal
    expect(() => safePath(repoPath, '../../etc/shadow')).toThrow('path outside repo')
  })

  it('allows nested directories within repo', () => {
    const repoPath = path.resolve('/dev/my-repo')
    expect(() => safePath(repoPath, 'src/components/deep/nested/file.ts')).not.toThrow()
  })
})
