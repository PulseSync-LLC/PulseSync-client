import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'
import { DESKTOP_API_VERSION } from '../src/common/desktopApi/version.js'
import type { BootstrapperArtifact, BootstrapperUpdateManifest } from '../packages/bootstrapper/src/manifest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const defaultRendererManifestUrl = 'https://app.pulsesync.dev/desktop/manifest.json'

type EmitDesktopReleaseManifestOptions = {
    baseUrl: string
    channel: string
    dist: string
    packagedAppRootDir: string
    releaseDir: string
    rendererManifestUrl?: string
    resourcesDir: string
    version: string
}

type ParsedDist = {
    arch: string
    platform: NodeJS.Platform
}

const appArtifactPreference: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: ['dmg', 'zip'],
    linux: ['deb', 'appimage', 'rpm', 'tar.gz'],
    win32: ['exe'],
}

export function getDesktopReleaseManifestName(dist: string): string {
    return `desktop-update-${dist}.json`
}

function resolveInsideProject(targetPath: string): string {
    const resolvedPath = path.resolve(projectRoot, targetPath)
    const relativePath = path.relative(projectRoot, resolvedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Path must stay inside the project: ${targetPath}`)
    }
    return resolvedPath
}

function parseDist(dist: string): ParsedDist {
    const match = /^(aix|darwin|freebsd|linux|openbsd|sunos|win32)-([a-z0-9_ -]+)$/iu.exec(dist)
    if (!match) {
        throw new Error(`Invalid desktop release dist: ${dist}`)
    }

    return {
        platform: match[1] as NodeJS.Platform,
        arch: match[2].toLowerCase(),
    }
}

function getArchAliases(arch: string): string[] {
    if (arch === 'x64') return ['x64', 'amd64']
    if (arch === 'arm64') return ['arm64', 'aarch64']
    return [arch]
}

function readArgValue(args: string[], name: string): string | null {
    const index = args.indexOf(name)
    if (index === -1) return null
    return args[index + 1] ?? null
}

function normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/u, '')
    if (!/^https?:\/\//iu.test(normalized)) {
        throw new Error(`Desktop release manifest base URL must be http(s): ${baseUrl}`)
    }
    return normalized
}

function getArtifactExtension(fileName: string): string {
    const lower = fileName.toLowerCase()
    if (lower.endsWith('.tar.gz')) return 'tar.gz'
    return path.extname(lower).replace(/^\./u, '')
}

function isVersionedAppArtifact(fileName: string, version: string): boolean {
    const lower = fileName.toLowerCase()
    return lower.startsWith(`pulsesync-app-${version.toLowerCase()}-`) && !lower.endsWith('.blockmap')
}

function findAppArtifact(releaseDir: string, version: string, dist: string): string {
    const { arch, platform } = parseDist(dist)
    const extensionPreference = appArtifactPreference[platform]
    if (!extensionPreference) {
        throw new Error(`Unsupported desktop release platform: ${platform}`)
    }

    const archAliases = getArchAliases(arch)
    const candidates = fs
        .readdirSync(releaseDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && isVersionedAppArtifact(entry.name, version))
        .filter(entry => extensionPreference.includes(getArtifactExtension(entry.name)))
        .filter(entry => {
            const lower = entry.name.toLowerCase()
            return archAliases.some(alias => lower.includes(`-${alias}.`) || lower.includes(`-${alias}-`))
        })
        .sort((left, right) => {
            const leftIndex = extensionPreference.indexOf(getArtifactExtension(left.name))
            const rightIndex = extensionPreference.indexOf(getArtifactExtension(right.name))
            return leftIndex - rightIndex || left.name.localeCompare(right.name)
        })

    const artifact = candidates[0]
    if (!artifact) {
        throw new Error(`App artifact for ${version} (${dist}) was not found in ${releaseDir}`)
    }

    return path.join(releaseDir, artifact.name)
}

function directoryHasFiles(directoryPath: string): boolean {
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
        return false
    }

    return fs.readdirSync(directoryPath, { withFileTypes: true }).some(entry => {
        const entryPath = path.join(directoryPath, entry.name)
        return entry.isFile() || (entry.isDirectory() && directoryHasFiles(entryPath))
    })
}

function writeDirectoryZip(sourceDir: string, targetPath: string, archiveRoot: string): void {
    if (!directoryHasFiles(sourceDir)) {
        throw new Error(`Cannot create ${path.basename(targetPath)}: ${sourceDir} has no files`)
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.rmSync(targetPath, { force: true })

    const zip = new AdmZip()
    zip.addLocalFolder(sourceDir, archiveRoot)
    zip.writeZip(targetPath)
}

async function sha256File(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

async function createArtifactDescriptor(filePath: string, baseUrl: string): Promise<BootstrapperArtifact> {
    const stat = await fs.promises.stat(filePath)
    return {
        url: `${baseUrl}/${path.basename(filePath)}`,
        sha256: await sha256File(filePath),
        size: stat.size,
    }
}

function createBootstrapperArchive(releaseDir: string, resourcesDir: string, version: string, dist: string): string {
    const bootstrapperDir = path.join(resourcesDir, 'bootstrapper')
    const archivePath = path.join(releaseDir, `pulsesync-bootstrapper-${version}-${dist}.zip`)
    writeDirectoryZip(bootstrapperDir, archivePath, 'bootstrapper')
    return archivePath
}

function createNativeModulesArchive(releaseDir: string, packagedAppRootDir: string, version: string, dist: string): string {
    const nativeModulesDir = path.join(packagedAppRootDir, 'modules')
    const archivePath = path.join(releaseDir, `pulsesync-native-modules-${version}-${dist}.zip`)
    writeDirectoryZip(nativeModulesDir, archivePath, 'modules')
    return archivePath
}

function parseDeprecatedVersions(): string[] | undefined {
    const values = (process.env.DEPRECATED_VERSIONS ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)

    return values.length ? values : undefined
}

export async function emitDesktopReleaseManifest(options: EmitDesktopReleaseManifestOptions): Promise<string> {
    const releaseDir = resolveInsideProject(options.releaseDir)
    const resourcesDir = resolveInsideProject(options.resourcesDir)
    const packagedAppRootDir = resolveInsideProject(options.packagedAppRootDir)
    const baseUrl = normalizeBaseUrl(options.baseUrl)
    const appArtifactPath = findAppArtifact(releaseDir, options.version, options.dist)
    const nativeModulesArchivePath = createNativeModulesArchive(releaseDir, packagedAppRootDir, options.version, options.dist)
    const bootstrapperArchivePath = createBootstrapperArchive(releaseDir, resourcesDir, options.version, options.dist)

    const deprecatedVersions = parseDeprecatedVersions()
    const manifest: BootstrapperUpdateManifest = {
        schemaVersion: 1,
        channel: options.channel,
        clientVersion: options.version,
        desktopApi: DESKTOP_API_VERSION,
        rendererManifestUrl: options.rendererManifestUrl?.trim() || defaultRendererManifestUrl,
        artifacts: {
            [options.dist]: {
                app: await createArtifactDescriptor(appArtifactPath, baseUrl),
                nativeModules: await createArtifactDescriptor(nativeModulesArchivePath, baseUrl),
                bootstrapper: await createArtifactDescriptor(bootstrapperArchivePath, baseUrl),
            },
        },
        ...(deprecatedVersions ? { deprecatedVersions } : {}),
    }

    const manifestPath = path.join(releaseDir, getDesktopReleaseManifestName(options.dist))
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8')
    return manifestPath
}

function resolveBaseUrl(args: string[], channel: string): string {
    const explicitBaseUrl = readArgValue(args, '--base-url')
    if (explicitBaseUrl) return explicitBaseUrl

    const s3Url = process.env.S3_URL?.trim()
    if (!s3Url) {
        throw new Error('--base-url is required when S3_URL is not set')
    }

    return `${s3Url.replace(/\/+$/u, '')}/builds/app/${channel}`
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const channel = readArgValue(args, '--channel')
    const dist = readArgValue(args, '--dist')
    const version = readArgValue(args, '--version')
    const packagedAppRootDir = readArgValue(args, '--packaged-app-root-dir')
    const resourcesDir = readArgValue(args, '--resources-dir')

    if (!channel || !dist || !version || !packagedAppRootDir || !resourcesDir) {
        throw new Error(
            'Usage: tsx scripts/desktop-release-manifest.ts --channel <name> --dist <platform-arch> --version <version> --packaged-app-root-dir <path> --resources-dir <path> [--release-dir release] [--base-url https://...]',
        )
    }

    const manifestPath = await emitDesktopReleaseManifest({
        baseUrl: resolveBaseUrl(args, channel),
        channel,
        dist,
        packagedAppRootDir,
        releaseDir: readArgValue(args, '--release-dir') || 'release',
        rendererManifestUrl: readArgValue(args, '--renderer-manifest-url') || process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
        resourcesDir,
        version,
    })
    console.log(`PulseSync desktop release manifest generated: ${manifestPath}`)
}

const isDirectRun = process.argv[1] != null && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
