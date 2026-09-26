import { createHash } from 'node:crypto'

export type ModuleManifest = {
    formatVersion: 1
    runtime: 'isolated'
    kind: 'web-addon'
    apiVersion: 1
    capabilities: ['modules-v1']
    allowedUrls: string[]
    modules: Record<string, { moduleId: string; apiMajor: number; optional: boolean; version?: string; channel?: 'stable' | 'dev' }>
}
export type ModuleAddon = { id: string; code: string; catalogAddonId: string; securityManifest: ModuleManifest }
export type Descriptor = { sha256: string; size: number; versionId: string; kind: 'javascript' | 'wasm' }
export type Resolution = {
    releaseBinding: string
    resolution: string
    descriptors: Record<string, Descriptor>
    errors: Record<string, string>
    activationId: string
}
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function throwModuleError(code = 'access-denied'): never {
    throw new Error(`PulseSync modules: ${code}`)
}

export function createModuleManifest(modules: unknown, allowedUrls: unknown): ModuleManifest {
    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return throwModuleError('incompatible-api')
    const entries = Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    if (!entries.length || entries.length > 20 || (allowedUrls !== undefined && !Array.isArray(allowedUrls)))
        return throwModuleError('incompatible-api')
    const refs: ModuleManifest['modules'] = Object.create(null)
    for (const [alias, ref] of entries) {
        if (
            !/^[a-z][a-z0-9_-]{0,63}$/.test(alias) ||
            !ref ||
            typeof ref !== 'object' ||
            !/^[a-f0-9-]{36}$/i.test(ref.moduleId) ||
            !Number.isSafeInteger(ref.apiMajor) ||
            ref.apiMajor < 1 ||
            Object.keys(ref).some(key => !['moduleId', 'apiMajor', 'optional', 'version', 'channel'].includes(key)) ||
            (ref.optional !== undefined && typeof ref.optional !== 'boolean') ||
            (ref.version !== undefined
                ? ref.channel !== undefined || typeof ref.version !== 'string' || ref.version.length > 80
                : !['stable', 'dev'].includes(ref.channel))
        ) {
            return throwModuleError('incompatible-api')
        }
        refs[alias] = {
            moduleId: ref.moduleId.toLowerCase(),
            apiMajor: ref.apiMajor,
            optional: Boolean(ref.optional),
            ...(ref.version !== undefined ? { version: ref.version } : { channel: ref.channel }),
        }
    }
    const urls = (allowedUrls ?? []) as unknown[]
    if (urls.length > 100 || urls.some(url => typeof url !== 'string' || url.length > 2048)) return throwModuleError('incompatible-api')
    return {
        formatVersion: 1,
        runtime: 'isolated',
        kind: 'web-addon',
        apiVersion: 1,
        capabilities: ['modules-v1'],
        allowedUrls: [...new Set((urls as string[]).map(url => url.trim()).filter(Boolean))].sort(),
        modules: refs,
    }
}
