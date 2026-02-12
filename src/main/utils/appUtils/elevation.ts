import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

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

export async function replaceDirWithElevation(sourceDir: string, targetDir: string): Promise<void> {
    if (process.platform !== 'linux') {
        throw new Error('replaceDirWithElevation is only supported on Linux')
    }
    if (path.basename(targetDir) !== 'app.asar.unpacked') {
        throw new Error(`Unsafe targetDir for elevated replace: ${targetDir}`)
    }

    const targetParent = path.dirname(targetDir)
    await runPkexecCandidates([
        ['/bin/mkdir', '-p', '--', targetParent],
        ['mkdir', '-p', '--', targetParent],
    ])

    await runPkexecCandidates([
        ['/bin/rm', '-rf', '--', targetDir],
        ['rm', '-rf', '--', targetDir],
    ])

    await runPkexecCandidates([
        ['/bin/cp', '-a', '--', sourceDir, targetDir],
        ['cp', '-a', '--', sourceDir, targetDir],
    ])
}
