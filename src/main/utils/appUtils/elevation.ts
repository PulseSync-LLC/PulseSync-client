import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const ELEVATION_ACCESS_CODES = new Set(['EACCES', 'EPERM'])

export const isLinuxAccessError = (error: any): boolean => process.platform === 'linux' && ELEVATION_ACCESS_CODES.has(error?.code)

export async function runPkexecCandidates(candidates: string[][]): Promise<void> {
    let lastError: any = null
    for (const args of candidates) {
        try {
            await execFileAsync('pkexec', args)
            return
        } catch (error) {
            lastError = error
        }
    }
    throw lastError
}

export function formatPkexecError(error: any): string {
    const stderr = error?.stderr
    if (typeof stderr === 'string' && stderr.trim()) {
        return stderr.trim()
    }
    if (Buffer.isBuffer(stderr)) {
        const text = stderr.toString('utf8').trim()
        if (text) return text
    }
    return error?.message || 'pkexec failed'
}

export async function grantLinuxOwnershipWithPkexec(targetDir: string): Promise<void> {
    if (process.platform !== 'linux') return
    const uid = typeof process.getuid === 'function' ? String(process.getuid()) : null
    const gid = typeof process.getgid === 'function' ? String(process.getgid()) : null
    if (!uid || !gid) {
        throw new Error('Unable to detect current user UID/GID')
    }
    const owner = `${uid}:${gid}`
    await runPkexecCandidates([
        ['/bin/chown', '-R', owner, '--', targetDir],
        ['/usr/bin/chown', '-R', owner, '--', targetDir],
        ['chown', '-R', owner, '--', targetDir],
    ])
}
