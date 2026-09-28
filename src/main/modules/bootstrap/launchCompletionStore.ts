import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

const MAX_COMPLETED_LAUNCH_REQUESTS = 256

type LaunchCompletionState = {
    schemaVersion: 1
    completedIds: string[]
}

function statePath(): string {
    return path.join(app.getPath('userData'), 'runtime', 'completed-launch-requests.json')
}

function normalizeIds(values: unknown): string[] {
    if (!Array.isArray(values)) return []
    const ids: string[] = []
    for (const value of values) {
        if (typeof value !== 'string' || !value || value.length > 128) continue
        const previousIndex = ids.indexOf(value)
        if (previousIndex !== -1) ids.splice(previousIndex, 1)
        ids.push(value)
    }
    return ids.slice(-MAX_COMPLETED_LAUNCH_REQUESTS)
}

export function readCompletedLaunchRequestIds(): string[] {
    try {
        const state = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<LaunchCompletionState>
        return state.schemaVersion === 1 ? normalizeIds(state.completedIds) : []
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
}

export function writeCompletedLaunchRequestIds(values: Iterable<string>): string[] {
    const completedIds = normalizeIds(Array.from(values))
    const destination = statePath()
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    try {
        const state: LaunchCompletionState = { schemaVersion: 1, completedIds }
        fs.writeFileSync(temporary, `${JSON.stringify(state, null, 4)}\n`, 'utf8')
        fs.renameSync(temporary, destination)
    } finally {
        fs.rmSync(temporary, { force: true })
    }
    return completedIds
}

export function migrateCompletedLaunchRequestIds(legacyValues: unknown): string[] {
    const legacyIds = normalizeIds(legacyValues)
    if (!legacyIds.length) return readCompletedLaunchRequestIds()
    return writeCompletedLaunchRequestIds([...readCompletedLaunchRequestIds(), ...legacyIds])
}
