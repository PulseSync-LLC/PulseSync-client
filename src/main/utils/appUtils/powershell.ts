import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const runPowerShell = async (script: string, args: string[] = []): Promise<string> => {
    const psArgs = ['-NoProfile', '-NonInteractive', '-Command', script, ...args]
    const { stdout } = (await execFileAsync('powershell.exe', psArgs, {
        windowsHide: true,
        timeout: 10000,
    })) as { stdout: string }
    return stdout ?? ''
}
