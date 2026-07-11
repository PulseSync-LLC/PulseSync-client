import fs from 'node:fs'
import path from 'node:path'
import { getBootstrapperRuntimePaths } from '../bootstrapper/paths'

export interface BootstrapSettings {
    schemaVersion: 1
    updateChannelOverride: string
    updateSource: string
    remoteRendererManifestUrl: string
}

const DEFAULT_SETTINGS: BootstrapSettings = {
    schemaVersion: 1,
    updateChannelOverride: '',
    updateSource: 'backend',
    remoteRendererManifestUrl: '',
}

function settingsPath(): string {
    return path.join(getBootstrapperRuntimePaths().stateRoot, 'runtime', 'bootstrap-settings.json')
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function parseSettings(value: unknown): BootstrapSettings {
    if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }
    const input = value as Partial<BootstrapSettings>
    if (input.schemaVersion !== 1) return { ...DEFAULT_SETTINGS }
    return {
        schemaVersion: 1,
        updateChannelOverride: normalizeString(input.updateChannelOverride),
        updateSource: normalizeString(input.updateSource) || DEFAULT_SETTINGS.updateSource,
        remoteRendererManifestUrl: normalizeString(input.remoteRendererManifestUrl),
    }
}

export function readBootstrapSettings(): BootstrapSettings {
    try {
        return parseSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
    } catch {
        return { ...DEFAULT_SETTINGS }
    }
}

export function writeBootstrapSettings(patch: Partial<Omit<BootstrapSettings, 'schemaVersion'>>): BootstrapSettings {
    const next = parseSettings({ ...readBootstrapSettings(), ...patch, schemaVersion: 1 })
    const destination = settingsPath()
    const directory = path.dirname(destination)
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    fs.mkdirSync(directory, { recursive: true })
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
        fs.renameSync(temporary, destination)
    } finally {
        fs.rmSync(temporary, { force: true })
    }
    return next
}
