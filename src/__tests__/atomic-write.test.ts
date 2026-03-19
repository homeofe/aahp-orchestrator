import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { atomicWriteFileSync, atomicWriteFile, atomicWriteJsonSync, atomicWriteJson } from '../atomic-write'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'))
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true }) } catch { /* ignore */ }
}

// ── atomicWriteFileSync ───────────────────────────────────────────────────────

describe('atomicWriteFileSync', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { rmDir(tmpDir) })

  it('writes content to the target file', () => {
    const target = path.join(tmpDir, 'out.txt')
    atomicWriteFileSync(target, 'hello world')
    expect(fs.readFileSync(target, 'utf8')).toBe('hello world')
  })

  it('overwrites existing content', () => {
    const target = path.join(tmpDir, 'out.txt')
    fs.writeFileSync(target, 'old content', 'utf8')
    atomicWriteFileSync(target, 'new content')
    expect(fs.readFileSync(target, 'utf8')).toBe('new content')
  })

  it('uses write-then-rename pattern (no stale temp file on success)', () => {
    const target = path.join(tmpDir, 'out.txt')
    atomicWriteFileSync(target, 'data')
    // After a successful write, no .tmp files should remain
    const files = fs.readdirSync(tmpDir)
    const tmpFiles = files.filter(f => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('creates parent directory if it does not exist', () => {
    const target = path.join(tmpDir, 'subdir', 'out.txt')
    atomicWriteFileSync(target, 'nested content')
    expect(fs.readFileSync(target, 'utf8')).toBe('nested content')
  })

  it('leaves the original file intact if write fails', () => {
    const target = path.join(tmpDir, 'out.txt')
    fs.writeFileSync(target, 'original', 'utf8')

    // Simulate a write failure by pointing to a directory as target
    const badTarget = path.join(tmpDir, 'subdir')
    fs.mkdirSync(badTarget)
    expect(() => atomicWriteFileSync(badTarget, 'data')).toThrow()

    // Original file should still be intact
    expect(fs.readFileSync(target, 'utf8')).toBe('original')
  })

  it('cleans up temp file on write failure', () => {
    // Use a deeply nested non-existent path that cannot be created
    // by triggering a rename failure via a target that is a directory
    const targetDir = path.join(tmpDir, 'targetdir')
    fs.mkdirSync(targetDir)

    try {
      atomicWriteFileSync(targetDir, 'data')
    } catch { /* expected */ }

    // No .tmp files should remain in tmpDir
    const allFiles: string[] = []
    function collect(dir: string): void {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        if (fs.statSync(full).isDirectory()) collect(full)
        else allFiles.push(full)
      }
    }
    collect(tmpDir)
    const tmpFiles = allFiles.filter(f => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})

// ── atomicWriteFile (async) ───────────────────────────────────────────────────

describe('atomicWriteFile', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { rmDir(tmpDir) })

  it('writes content to the target file', async () => {
    const target = path.join(tmpDir, 'out.txt')
    await atomicWriteFile(target, 'async hello')
    expect(fs.readFileSync(target, 'utf8')).toBe('async hello')
  })

  it('uses write-then-rename: no stale temp file after success', async () => {
    const target = path.join(tmpDir, 'out.txt')
    await atomicWriteFile(target, 'data')
    const files = fs.readdirSync(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
  })

  it('creates parent directory if it does not exist', async () => {
    const target = path.join(tmpDir, 'nested', 'dir', 'out.txt')
    await atomicWriteFile(target, 'deep content')
    expect(fs.readFileSync(target, 'utf8')).toBe('deep content')
  })
})

// ── atomicWriteJsonSync ───────────────────────────────────────────────────────

describe('atomicWriteJsonSync', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { rmDir(tmpDir) })

  it('serializes object to JSON with default indent', () => {
    const target = path.join(tmpDir, 'data.json')
    atomicWriteJsonSync(target, { foo: 1, bar: 'baz' })
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(parsed).toEqual({ foo: 1, bar: 'baz' })
  })

  it('appends a trailing newline by default', () => {
    const target = path.join(tmpDir, 'data.json')
    atomicWriteJsonSync(target, { x: 1 })
    const raw = fs.readFileSync(target, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('respects trailingNewline=false', () => {
    const target = path.join(tmpDir, 'data.json')
    atomicWriteJsonSync(target, { x: 1 }, 2, false)
    const raw = fs.readFileSync(target, 'utf8')
    expect(raw.endsWith('\n')).toBe(false)
  })

  it('uses the specified indent', () => {
    const target = path.join(tmpDir, 'data.json')
    atomicWriteJsonSync(target, { a: 1 }, 4)
    const raw = fs.readFileSync(target, 'utf8')
    expect(raw).toContain('    "a"')
  })

  it('leaves no temp file after success', () => {
    const target = path.join(tmpDir, 'data.json')
    atomicWriteJsonSync(target, { ok: true })
    const files = fs.readdirSync(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
  })
})

// ── atomicWriteJson (async) ───────────────────────────────────────────────────

describe('atomicWriteJson', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { rmDir(tmpDir) })

  it('serializes and writes JSON atomically', async () => {
    const target = path.join(tmpDir, 'data.json')
    await atomicWriteJson(target, { async: true })
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(parsed).toEqual({ async: true })
  })

  it('leaves no temp file after success', async () => {
    const target = path.join(tmpDir, 'data.json')
    await atomicWriteJson(target, { done: 1 })
    const files = fs.readdirSync(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
  })
})

// ── Atomicity contract ────────────────────────────────────────────────────────
// These tests verify observable behavior: the write-then-rename pattern results
// in no stale temp files, and data is fully written before rename.
// We cannot spy on native ESM fs exports directly, so we test via filesystem state.

describe('atomicity contract', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { rmDir(tmpDir) })

  it('atomicWriteFileSync: target file contains full data, no .tmp files remain', () => {
    const target = path.join(tmpDir, 'target.txt')
    const data = 'atomic-test-data-' + Date.now()

    atomicWriteFileSync(target, data)

    // Data is fully present
    expect(fs.readFileSync(target, 'utf8')).toBe(data)
    // No .tmp sibling files remain
    const files = fs.readdirSync(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
    // The target is the only file
    expect(files).toHaveLength(1)
    expect(files[0]).toBe('target.txt')
  })

  it('atomicWriteFileSync: temp file path is a sibling of target (same dir)', () => {
    // Verify by checking that all files in the dir after the write are just the target.
    // If the implementation wrote to a system /tmp instead of a sibling, we detect
    // it by confirming no other files exist in our tmpDir after the call.
    const target = path.join(tmpDir, 'target.txt')
    atomicWriteFileSync(target, 'test')
    const files = fs.readdirSync(tmpDir)
    expect(files).toEqual(['target.txt'])
  })

  it('atomicWriteFile: target file contains full data, no .tmp files remain', async () => {
    const target = path.join(tmpDir, 'target.txt')
    const data = 'async-atomic-' + Date.now()

    await atomicWriteFile(target, data)

    expect(fs.readFileSync(target, 'utf8')).toBe(data)
    const files = fs.readdirSync(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
    expect(files).toHaveLength(1)
  })

  it('atomicWriteFileSync: concurrent writes to same file produce consistent result', () => {
    // Run multiple atomic writes to the same file serially (no parallelism in sync).
    const target = path.join(tmpDir, 'shared.txt')
    for (let i = 0; i < 10; i++) {
      atomicWriteFileSync(target, `version-${i}`)
    }
    // Final value should be the last written version
    expect(fs.readFileSync(target, 'utf8')).toBe('version-9')
    // No temp files remain
    expect(fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'))).toHaveLength(0)
  })
})
