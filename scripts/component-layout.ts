import fs from 'node:fs'
import path from 'node:path'

export type RuntimeComponentMetadata = {
    diskName: string
    name: string
    revision: number
    version: string
}

type DesktopCorePackage = {
    version: string
    componentVersions?: Record<string, string>
    componentRevisions?: Record<string, number>
    componentDiskNames?: Record<string, string>
}

function readRevisionOverrides(): Record<string, number> | null {
    const raw = process.env.PULSESYNC_COMPONENT_REVISIONS?.trim()
    if (!raw) return null

    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('PULSESYNC_COMPONENT_REVISIONS must be a JSON object')
    }

    return value as Record<string, number>
}

export function readRuntimeComponentMetadata(projectRoot: string): Record<string, RuntimeComponentMetadata> {
    const packagePath = path.join(projectRoot, 'packages', 'desktop-core', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as DesktopCorePackage
    const names = ['desktopCore', ...Object.keys(packageJson.componentVersions ?? {})]
    const revisionOverrides = readRevisionOverrides()
    if (revisionOverrides) {
        for (const name of Object.keys(revisionOverrides)) {
            if (!names.includes(name)) throw new Error(`Unknown component revision override: ${name}`)
        }
    }
    const components: Record<string, RuntimeComponentMetadata> = {}

    for (const name of names) {
        const version = name === 'desktopCore' ? packageJson.version : packageJson.componentVersions?.[name]
        const revision = revisionOverrides?.[name] ?? packageJson.componentRevisions?.[name]
        const diskName = packageJson.componentDiskNames?.[name]
        if (!version || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(version)) {
            throw new Error(`Missing valid component version for ${name}`)
        }
        if (!Number.isSafeInteger(revision) || revision === undefined || revision <= 0) {
            throw new Error(`Missing positive component revision for ${name}`)
        }
        if (!diskName || !/^[a-z][a-z0-9_]*$/u.test(diskName)) {
            throw new Error(`Missing valid component disk name for ${name}`)
        }
        if (Object.values(components).some(component => component.diskName === diskName)) {
            throw new Error(`Duplicate component disk name: ${diskName}`)
        }
        components[name] = { diskName, name, revision, version }
    }

    return components
}

export function componentContainerName(component: RuntimeComponentMetadata): string {
    return `${component.diskName}-${component.revision}`
}
