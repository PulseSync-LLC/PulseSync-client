import fs from 'node:fs'
import path from 'node:path'

import { getActiveComponentPath } from '../bootstrap/activeComponents'

declare const __non_vite_require__: (moduleId: string) => unknown

export type NativeArtifactDurations = {
    readMs: number
    checksumMs: number
    decompressMs: number
    writeMs: number
    cloneMs: number
    extractMs: number
    cacheWriteMs: number
    backupMs: number
    installMs: number
    cleanupMs: number
}

export type NativeArtifactWarning = {
    stage: string
    code?: string
    message: string
}

export type NativeArtifactResult = {
    ok: boolean
    stage?: string
    code?: string
    message?: string
    preparedPath?: string
    durations: NativeArtifactDurations
    warnings: NativeArtifactWarning[]
}

export type NativePrepareAsarArtifactRequest = {
    archivePath: string
    archiveExtension: string
    expectedChecksum?: string
    outputPath: string
}

export type NativeInstallUnpackedArtifactRequest = {
    sourceKind: 'archive' | 'directory'
    archivePath: string
    archiveExtension: string
    expectedChecksum?: string
    preparedDirectoryPath?: string
    preparedDirectoryMarker?: {
        fileName: string
        value: string
    }
    stagingPath: string
    targetPath: string
}

export interface PulseSyncNativeAddon {
    nativeVersion(): string
    getHardwareIdentity(): { hash: string; source: string; algorithm: 'sha256' } | null
    watch(target: string, intervalMs: number, callback: (eventType: string, filename: string) => void): void
    readFile(target: string): Buffer
    deleteFile(target: string): void
    renameFile(oldPath: string, newPath: string): void
    moveFile(source: string, destination: string): void
    copyFile(source: string, destination: string): void
    fileExists(target: string): boolean
    hashFile(target: string): string
    prepareAsarArtifact(request: NativePrepareAsarArtifactRequest): NativeArtifactResult
    installUnpackedArtifact(request: NativeInstallUnpackedArtifactRequest): NativeArtifactResult
    calculateAsarHeaderHash(target: string): string
    readAsarVersion(target: string): string
    patchWindowsIntegrity(exePath: string, asarPath: string): string
    patchMacIntegrity(appBundlePath: string, asarPath: string, entitlementsPath: string): string
}

let cachedAddon: PulseSyncNativeAddon | null | undefined

function findPackagedNativeModule(): string | null {
    const modulesDir = path.join(path.dirname(process.resourcesPath), 'modules')
    try {
        const container = fs.readdirSync(modulesDir).find(name => name.startsWith('pulsesync_native-'))
        return container ? path.join(modulesDir, container, 'pulsesync_native', 'pulsesyncNative.node') : null
    } catch {
        return null
    }
}

function resolveNativeModulePath(): string | null {
    const candidates = [path.resolve(process.cwd(), 'nativeModules', 'pulsesyncNative', 'build', 'Release', 'pulsesyncNative.node')]
    const activeComponentPath = getActiveComponentPath('pulsesyncNative')
    if (activeComponentPath) candidates.push(path.join(activeComponentPath, 'pulsesyncNative.node'))
    if (typeof process.resourcesPath === 'string') {
        const packagedNativeModule = findPackagedNativeModule()
        if (packagedNativeModule) candidates.push(packagedNativeModule)
    }
    return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

export function loadPulseSyncNative(): PulseSyncNativeAddon | null {
    if (cachedAddon !== undefined) return cachedAddon
    const modulePath = resolveNativeModulePath()
    if (!modulePath) {
        cachedAddon = null
        return null
    }
    cachedAddon = __non_vite_require__(modulePath) as PulseSyncNativeAddon
    return cachedAddon
}

export function requirePulseSyncNative(): PulseSyncNativeAddon {
    const addon = loadPulseSyncNative()
    if (!addon) throw new Error('pulsesyncNative addon is not available')
    return addon
}
