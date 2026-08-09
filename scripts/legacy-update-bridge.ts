import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import semver from 'semver'
import { resolveStructuredPublishPath } from './s3-upload.js'

const LEGACY_UPDATE_BRIDGE_BASE_VERSIONS: Readonly<Record<'beta' | 'dev', ReadonlySet<string>>> = {
    beta: new Set(['3.0.0', '3.0.1', '3.0.2', '3.0.3', '3.0.4']),
    dev: new Set(['3.0.0', '3.0.1', '3.0.2', '3.0.3', '3.0.4']),
}

export type EmitLegacyUpdateBridgeOptions = {
    baseUrl: string
    platform?: NodeJS.Platform
    releaseDir: string
    version: string
}

type ArtifactDigest = {
    sha256: string
    sha512Base64: string
    sha512Hex: string
    size: number
}

export function isLegacyUpdateBridgeEnabled(channel: string | null, version: string): boolean {
    if (channel !== 'dev' && channel !== 'beta') return false
    const parsedVersion = semver.parse(version)
    if (!parsedVersion) return false
    const prereleaseChannel = parsedVersion.prerelease[0]
    if (typeof prereleaseChannel !== 'string' || prereleaseChannel.toLowerCase() !== channel) return false
    const baseVersion = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`
    return LEGACY_UPDATE_BRIDGE_BASE_VERSIONS[channel].has(baseVersion)
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function findArtifact(releaseDir: string, pattern: RegExp, label: string): string {
    const matches = fs
        .readdirSync(releaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && pattern.test(entry.name))
        .map(entry => path.join(releaseDir, entry.name))
    if (matches.length !== 1) {
        throw new Error(`Expected one ${label} artifact in ${releaseDir}, found ${matches.length}`)
    }
    return matches[0]
}

async function digestArtifact(filePath: string): Promise<ArtifactDigest> {
    const sha256 = crypto.createHash('sha256')
    const sha512 = crypto.createHash('sha512')
    let size = 0
    await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => {
            size += chunk.length
            sha256.update(chunk)
            sha512.update(chunk)
        })
        stream.on('error', reject)
        stream.on('end', resolve)
    })
    const sha512Buffer = sha512.digest()
    return {
        sha256: sha256.digest('hex'),
        sha512Base64: sha512Buffer.toString('base64'),
        sha512Hex: sha512Buffer.toString('hex'),
        size,
    }
}

async function writeWindowsBridge(releaseDir: string, version: string): Promise<string> {
    const escapedVersion = escapeRegExp(version)
    const setupPath = findArtifact(releaseDir, new RegExp(`^pulsesync-app-${escapedVersion}-[a-z0-9_-]+\\.exe$`, 'iu'), 'Windows setup')
    const setupName = path.basename(setupPath)
    const digest = await digestArtifact(setupPath)
    const metadata = {
        version,
        files: [{ url: setupName, sha512: digest.sha512Base64, size: digest.size }],
        path: setupName,
        sha512: digest.sha512Base64,
        releaseDate: new Date().toISOString(),
    }
    const metadataPath = path.join(releaseDir, 'latest.yml')
    fs.writeFileSync(metadataPath, yaml.dump(metadata, { lineWidth: 150, noRefs: true }), 'utf8')
    return metadataPath
}

async function writeLinuxBridge(releaseDir: string, version: string): Promise<string> {
    const escapedVersion = escapeRegExp(version)
    const packagePath = findArtifact(releaseDir, new RegExp(`^pulsesync-app-${escapedVersion}-[a-z0-9_-]+\\.deb$`, 'iu'), 'Linux DEB')
    const packageName = path.basename(packagePath)
    const digest = await digestArtifact(packagePath)
    const metadata = {
        version,
        files: [{ url: packageName, sha512: digest.sha512Base64, size: digest.size }],
        path: packageName,
        sha512: digest.sha512Base64,
        releaseDate: new Date().toISOString(),
    }
    const metadataPath = path.join(releaseDir, 'latest-linux.yml')
    fs.writeFileSync(metadataPath, yaml.dump(metadata, { lineWidth: 150, noRefs: true }), 'utf8')
    return metadataPath
}

async function writeMacBridge(releaseDir: string, version: string, baseUrl: string): Promise<string> {
    const escapedVersion = escapeRegExp(version)
    const dmgPath = findArtifact(releaseDir, new RegExp(`^pulsesync-app-${escapedVersion}-universal\\.dmg$`, 'iu'), 'universal macOS DMG')
    const digest = await digestArtifact(dmgPath)
    const relativeUrl = await resolveStructuredPublishPath(dmgPath, version)
    const url = `${baseUrl.replace(/\/+$/u, '')}/${relativeUrl}`
    const asset = (arch: 'arm64' | 'x64') => ({
        arch,
        url,
        fileType: 'dmg' as const,
        sha256: digest.sha256,
        sha512: digest.sha512Hex,
    })
    const metadata = {
        version,
        url,
        fileType: 'dmg',
        sha256: digest.sha256,
        sha512: digest.sha512Hex,
        assets: [asset('arm64'), asset('x64')],
    }
    const metadataPath = path.join(releaseDir, 'download.json')
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 4)}\n`, 'utf8')
    return metadataPath
}

export async function emitLegacyUpdateBridge(options: EmitLegacyUpdateBridgeOptions): Promise<string | null> {
    const releaseDir = path.resolve(options.releaseDir)
    const platform = options.platform ?? process.platform
    if (platform === 'win32') return await writeWindowsBridge(releaseDir, options.version)
    if (platform === 'darwin') return await writeMacBridge(releaseDir, options.version, options.baseUrl)
    if (platform === 'linux') return await writeLinuxBridge(releaseDir, options.version)
    return null
}
