import type { ProcessInfo } from './types'

const splitNonEmptyLines = (output: string): string[] =>
    output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

const parsePid = (value: string): number | null => {
    const pid = parseInt(value, 10)
    return Number.isNaN(pid) ? null : pid
}

export const parseMacPgrep = (stdout: string): ProcessInfo[] =>
    splitNonEmptyLines(stdout)
        .map(line => parsePid(line))
        .filter((pid): pid is number => pid !== null)
        .map(pid => ({ pid }))

export const parseLinuxPgrep = (stdout: string): ProcessInfo[] =>
    splitNonEmptyLines(stdout)
        .map(line => parsePid(line.split(' ')[0]))
        .filter((pid): pid is number => pid !== null)
        .map(pid => ({ pid }))

export const parseWindowsTasklist = (stdout: string): ProcessInfo[] => {
    const processes = splitNonEmptyLines(stdout)
    const parsed: ProcessInfo[] = []
    processes.forEach(line => {
        const parts = line.split('","')
        if (parts.length <= 1) return
        const pidStr = parts[1].replace(/"/g, '').trim()
        const pid = parsePid(pidStr)
        if (pid !== null) parsed.push({ pid })
    })
    return parsed
}
