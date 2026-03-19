import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Write `data` to `filePath` atomically using a write-then-rename pattern.
 *
 * The file is first written to a sibling temp file in the same directory,
 * then `fs.renameSync` atomically replaces the target. This prevents data
 * corruption if the process is killed between the write and the rename - the
 * old file stays intact until the rename succeeds.
 *
 * @param filePath - Absolute path to the destination file.
 * @param data     - String content to write (UTF-8).
 * @throws If the directory does not exist or the write/rename fails.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`)
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(tmp, data, 'utf8')
    fs.renameSync(tmp, filePath)
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmp) } catch { /* ignore cleanup errors */ }
    throw err
  }
}

/**
 * Async variant of atomicWriteFileSync. Writes via a temp file and renames.
 *
 * @param filePath - Absolute path to the destination file.
 * @param data     - String content to write (UTF-8).
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(tmp, data, 'utf8')
    await fs.promises.rename(tmp, filePath)
  } catch (err) {
    try { await fs.promises.unlink(tmp) } catch { /* ignore */ }
    throw err
  }
}

/**
 * Atomic JSON write helper. Serializes `value` to JSON and writes atomically.
 *
 * @param filePath  - Absolute path to the destination file.
 * @param value     - Value to serialize (must be JSON-serializable).
 * @param indent    - JSON indentation (default: 2).
 * @param trailingNewline - Append a trailing newline (default: true).
 */
export function atomicWriteJsonSync(
  filePath: string,
  value: unknown,
  indent = 2,
  trailingNewline = true
): void {
  const json = JSON.stringify(value, null, indent) + (trailingNewline ? '\n' : '')
  atomicWriteFileSync(filePath, json)
}

/**
 * Async JSON write helper. Serializes `value` to JSON and writes atomically.
 */
export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  indent = 2,
  trailingNewline = true
): Promise<void> {
  const json = JSON.stringify(value, null, indent) + (trailingNewline ? '\n' : '')
  await atomicWriteFile(filePath, json)
}
