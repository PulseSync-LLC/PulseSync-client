import { parse } from 'acorn'
import * as fs from 'original-fs'

import { resolveExistingFileInsideBase } from '../../utils/addonPaths'
import { createModuleManifest, sha256, throwModuleError } from './protocol'

import type { Descriptor, ModuleManifest } from './protocol'

export function readLocalModules(root: string, allowedUrls: unknown) {
    const configPath = resolveExistingFileInsideBase(root, 'modules.local.json')
    if (!configPath) return undefined
    if (fs.statSync(configPath).size > 65536) return throwModuleError('incompatible-api')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!config || typeof config !== 'object' || Array.isArray(config)) return throwModuleError('incompatible-api')
    const entries = Object.entries(config).sort(([a], [b]) => a.localeCompare(b))
    if (!entries.length || entries.length > 20) return throwModuleError('incompatible-api')
    const refs: ModuleManifest['modules'] = Object.create(null)
    const descriptors: Record<string, Descriptor> = Object.create(null)
    const files: Record<string, string> = Object.create(null)
    for (const [alias, value] of entries) {
        const ref = value as { path?: unknown; kind?: unknown; apiMajor?: unknown }
        if (
            !/^[a-z][a-z0-9_-]{0,63}$/.test(alias) ||
            !ref ||
            typeof ref.path !== 'string' ||
            !['javascript', 'wasm'].includes(String(ref.kind)) ||
            !Number.isSafeInteger(ref.apiMajor) ||
            Number(ref.apiMajor) < 1
        )
            return throwModuleError('incompatible-api')
        const file = resolveExistingFileInsideBase(root, ref.path)
        if (!file) return throwModuleError('unavailable')
        const size = fs.statSync(file).size
        if (size < 1 || size > (ref.kind === 'javascript' ? 2 : 10) * 1024 * 1024) return throwModuleError('integrity-mismatch')
        const bytes = fs.readFileSync(file)
        if (bytes.length !== size) return throwModuleError('aborted')
        if (ref.kind === 'javascript') {
            const code = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
        } else if (!WebAssembly.validate(bytes)) return throwModuleError('incompatible-api')
        const hash = sha256(bytes)
        const id = sha256(alias)
            .slice(0, 32)
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
        const version = '0.0.0-local'
        refs[alias] = { moduleId: id, apiMajor: Number(ref.apiMajor), optional: false, version }
        descriptors[alias] = {
            formatVersion: 1,
            moduleId: id,
            versionId: hash,
            version,
            apiMajor: Number(ref.apiMajor),
            kind: ref.kind as 'javascript' | 'wasm',
            access: 'public',
            sha256: hash,
            size: bytes.length,
        }
        files[alias] = file
    }
    return { securityManifest: createModuleManifest(refs, allowedUrls), localModules: descriptors, files }
}
