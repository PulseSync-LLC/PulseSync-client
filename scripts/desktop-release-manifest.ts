import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'
import { DESKTOP_API_VERSION } from '../src/common/desktopApi/version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const defaultRendererManifestUrl = 'https://pulsesync.dev/app/desktop/manifest.json'

type BootstrapperArtifact = {
    sha256: string
    signature?: string
    signatureAlgorithm?: 'ed25519'
    size?: number
    url: string
}

type BootstrapperDistArtifacts = {
    layout: 'macos-bundle' | 'versioned-components'
    app: BootstrapperArtifact
    bootstrapper?: BootstrapperArtifact
    modules: Record<string, BootstrapperArtifact>
}

type BootstrapperUpdateManifest = {
    artifacts: Record<string, BootstrapperDistArtifacts>
    channel: string
    clientVersion: string
    deprecatedVersions?: string[]
    desktopApi?: string
    minClientVersion?: string
    rendererManifestUrl?: string
    schemaVersion: 1
}

type EmitDesktopReleaseManifestOptions = {
    baseUrl: string
    channel: string
    dist: string
    packagedAppRootDir: string
    releaseDir: string
    rendererManifestUrl?: string
    version: string
}

type ParsedDist = {
    arch: string
    platform: NodeJS.Platform
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

function zipEntryUnixMode(entry: AdmZip.IZipEntry): number {
    return (entry.header.attr >>> 16) & 0o7777
}

function appArchiveExecutablePath(platform: NodeJS.Platform): string | null {
    if (platform === 'darwin') {
        return 'app/MacOS/PulseSync'
    }
    if (platform === 'linux') {
        return 'app/pulsesync'
    }
    return null
}

function assertArchiveExecutableMode(archivePath: string, entryName: string): void {
    const zip = new AdmZip(archivePath)
    const entry = zip.getEntry(entryName)
    if (!entry) {
        throw new Error(`Archive ${path.basename(archivePath)} is missing executable entry: ${entryName}`)
    }

    const mode = zipEntryUnixMode(entry)
    if ((mode & 0o111) === 0) {
        throw new Error(`Archive ${path.basename(archivePath)} entry ${entryName} is not executable: ${mode.toString(8)}`)
    }
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

async function createVersionedArtifactDescriptor(
    filePath: string,
    baseUrl: string,
    version: string,
    dist: string,
    artifactPath: string,
): Promise<BootstrapperArtifact> {
    const stat = await fs.promises.stat(filePath)
    const sha256 = await sha256File(filePath)
    return {
        url: `${baseUrl}/versions/${version}/${dist}/${artifactPath.replace(/\\/g, '/')}/${sha256.slice(0, 16)}/${path.basename(filePath)}`,
        sha256,
        size: stat.size,
    }
}

function createAppPayloadArchive(releaseDir: string, packagedAppRootDir: string, version: string, dist: string): string {
    const { platform } = parseDist(dist)
    const appPayloadDir = path.join(packagedAppRootDir, 'app')
    const archivePath = path.join(releaseDir, `pulsesync-app-payload-${version}-${dist}.zip`)
    writeDirectoryZip(appPayloadDir, archivePath, path.basename(appPayloadDir))
    const executableEntry = appArchiveExecutablePath(platform)
    if (executableEntry) {
        assertArchiveExecutableMode(archivePath, executableEntry)
    }
    return archivePath
}

function createMacHostBundleArchive(releaseDir: string, packagedRootDir: string, version: string, dist: string): string {
    const appBundle = path.join(packagedRootDir, 'PulseSync.app')
    if (!fs.existsSync(appBundle) || !fs.statSync(appBundle).isDirectory()) {
        throw new Error(`Cannot create macOS host artifact: ${appBundle} is not a directory`)
    }
    const executable = path.join(appBundle, 'Contents', 'MacOS', 'PulseSync')
    const infoPlist = path.join(appBundle, 'Contents', 'Info.plist')
    const bootstrapper = path.join(appBundle, 'Contents', 'Resources', 'bootstrapper', 'pulsesync-bootstrapper')
    for (const required of [executable, infoPlist, bootstrapper]) {
        if (!fs.existsSync(required) || !fs.statSync(required).isFile()) {
            throw new Error(`Cannot create macOS host artifact; required file is missing: ${required}`)
        }
    }
    const archivePath = path.join(releaseDir, `pulsesync-host-bundle-${version}-${dist}.zip`)
    fs.mkdirSync(releaseDir, { recursive: true })
    fs.rmSync(archivePath, { force: true })
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appBundle, archivePath], { stdio: 'pipe' })
    return archivePath
}

function assertModuleName(moduleName: string): void {
    if (!/^[a-z0-9][a-z0-9_-]*$/iu.test(moduleName)) {
        throw new Error(`Invalid module artifact name: ${moduleName}`)
    }
}

function createModuleArchives(releaseDir: string, packagedAppRootDir: string, version: string, dist: string): Record<string, string> {
    const modulesDir = path.join(packagedAppRootDir, 'modules')
    if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) {
        throw new Error(`Cannot create module artifacts: ${modulesDir} is not a directory`)
    }

    const archives: Record<string, string> = {}
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) {
            throw new Error(`Module payload entry must be a directory: ${path.join(modulesDir, entry.name)}`)
        }
        assertModuleName(entry.name)
        const sourceDir = path.join(modulesDir, entry.name)
        const archivePath = path.join(releaseDir, `pulsesync-module-${entry.name}-${version}-${dist}.zip`)
        writeDirectoryZip(sourceDir, archivePath, path.join('modules', entry.name))
        archives[entry.name] = archivePath
    }

    if (!Object.keys(archives).length) {
        throw new Error(`Cannot create module artifacts: ${modulesDir} has no module directories`)
    }
    return archives
}

function bootstrapperExecutableName(platform: NodeJS.Platform): string {
    return platform === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper'
}

function createBootstrapperArtifact(releaseDir: string, packagedAppRootDir: string, version: string, dist: string): string {
    const { platform } = parseDist(dist)
    const sourcePath = path.join(packagedAppRootDir, 'bootstrapper', bootstrapperExecutableName(platform))
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`Cannot create bootstrapper artifact: ${sourcePath} is not a file`)
    }

    const extension = platform === 'win32' ? '.exe' : ''
    const artifactPath = path.join(releaseDir, `pulsesync-bootstrapper-${version}-${dist}${extension}`)
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.rmSync(artifactPath, { force: true })
    fs.copyFileSync(sourcePath, artifactPath)
    return artifactPath
}

function removeStaleBootstrapperArchive(releaseDir: string, version: string, dist: string): void {
    fs.rmSync(path.join(releaseDir, `pulsesync-bootstrapper-${version}-${dist}.zip`), { force: true })
}

function removeStaleNativeModulesArchive(releaseDir: string, version: string, dist: string): void {
    fs.rmSync(path.join(releaseDir, `pulsesync-native-modules-${version}-${dist}.zip`), { force: true })
}

function removeStaleInstallerAppArtifact(releaseDir: string, version: string): void {
    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
            continue
        }
        const lower = entry.name.toLowerCase()
        if (lower.startsWith(`pulsesync-app-${version.toLowerCase()}-`) && lower.endsWith('.blockmap')) {
            fs.rmSync(path.join(releaseDir, entry.name), { force: true })
        }
    }
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
    const packagedAppRootDir = resolveInsideProject(options.packagedAppRootDir)
    const baseUrl = normalizeBaseUrl(options.baseUrl)
    const { platform } = parseDist(options.dist)
    const macosBundle = platform === 'darwin'
    const appArtifactPath = macosBundle
        ? createMacHostBundleArchive(releaseDir, packagedAppRootDir, options.version, options.dist)
        : createAppPayloadArchive(releaseDir, packagedAppRootDir, options.version, options.dist)
    const bootstrapperArtifactPath = macosBundle ? null : createBootstrapperArtifact(releaseDir, packagedAppRootDir, options.version, options.dist)
    const moduleArchivePaths = macosBundle ? {} : createModuleArchives(releaseDir, packagedAppRootDir, options.version, options.dist)
    removeStaleBootstrapperArchive(releaseDir, options.version, options.dist)
    removeStaleNativeModulesArchive(releaseDir, options.version, options.dist)
    removeStaleInstallerAppArtifact(releaseDir, options.version)

    const deprecatedVersions = parseDeprecatedVersions()
    const manifest: BootstrapperUpdateManifest = {
        schemaVersion: 1,
        channel: options.channel,
        clientVersion: options.version,
        desktopApi: DESKTOP_API_VERSION,
        rendererManifestUrl: options.rendererManifestUrl?.trim() || defaultRendererManifestUrl,
        artifacts: {
            [options.dist]: {
                layout: macosBundle ? 'macos-bundle' : 'versioned-components',
                app: await createVersionedArtifactDescriptor(appArtifactPath, baseUrl, options.version, options.dist, 'app'),
                ...(bootstrapperArtifactPath
                    ? {
                          bootstrapper: await createVersionedArtifactDescriptor(
                              bootstrapperArtifactPath,
                              baseUrl,
                              options.version,
                              options.dist,
                              'bootstrapper',
                          ),
                      }
                    : {}),
                modules: Object.fromEntries(
                    await Promise.all(
                        Object.entries(moduleArchivePaths).map(async ([moduleName, archivePath]) => [
                            moduleName,
                            await createVersionedArtifactDescriptor(
                                archivePath,
                                baseUrl,
                                options.version,
                                options.dist,
                                path.join('modules', moduleName),
                            ),
                        ]),
                    ),
                ),
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

    if (!channel || !dist || !version || !packagedAppRootDir) {
        throw new Error(
            'Usage: tsx scripts/desktop-release-manifest.ts --channel <name> --dist <platform-arch> --version <version> --packaged-app-root-dir <path> [--release-dir release] [--base-url https://...]',
        )
    }

    const manifestPath = await emitDesktopReleaseManifest({
        baseUrl: resolveBaseUrl(args, channel),
        channel,
        dist,
        packagedAppRootDir,
        releaseDir: readArgValue(args, '--release-dir') || 'release',
        rendererManifestUrl: readArgValue(args, '--renderer-manifest-url') || process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
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
