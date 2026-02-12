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
