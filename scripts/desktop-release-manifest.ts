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

function readBootstrapperVersion(): string {
    const cargoToml = fs.readFileSync(path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml'), 'utf8')
    const version = /^version\s*=\s*"([^"]+)"/mu.exec(cargoToml)?.[1]
    if (!version) throw new Error('Bootstrapper package version is missing')
    return version
}

type BootstrapperArtifact = {
    sha256: string
    signature?: string
    signatureAlgorithm?: 'ed25519'
    size?: number
    url: string
}

type VersionedArtifact = {
    version: string
    required: boolean
    contentSha256?: string
    files?: VersionedFile[]
    requiresHost?: string
    electronAbi?: string
    artifact: BootstrapperArtifact
}

type VersionedFile = {
    path: string
    sha256: string
    size: number
    executable: boolean
    artifact: BootstrapperArtifact
    patches: DeltaArtifact[]
}

type DeltaArtifact = {
    provider: 'bsdiff'
    fromSha256: string
    resultSha256: string
    resultSize: number
    artifact: BootstrapperArtifact
}

type BootstrapperUpdateManifest = {
    channel: string
    desktopVersion: string
    bundleVersion: string
    metadataVersion: number
    desktopApi: string
    rendererManifestUrl: string
    schemaVersion: 3
    targets: Record<
        string,
        {
            layout: 'versioned-components' | 'macos-bundle'
            host: VersionedArtifact
            components: Record<string, VersionedArtifact>
            bootstrapper?: VersionedArtifact
        }
    >
}

type EmitDesktopReleaseManifestOptions = {
    baseUrl: string
    channel: string
    dist: string
    packagedAppRootDir: string
    releaseDir: string
    rendererManifestUrl?: string
    coreVersion: string
    hostVersion: string
    metadataVersion?: string | number
    previousManifestUrl?: string
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

function hostArchiveExecutablePath(platform: NodeJS.Platform): string | null {
    if (platform === 'darwin') {
        return 'host/MacOS/PulseSync'
    }
    if (platform === 'linux') {
        return 'host/pulsesync'
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

async function createVersionedArtifactDescriptor(filePath: string, baseUrl: string, immutablePath: string): Promise<BootstrapperArtifact> {
    const stat = await fs.promises.stat(filePath)
    const sha256 = await sha256File(filePath)
    return {
        url: `${baseUrl}/${immutablePath.replace(/\\/g, '/')}/${sha256.slice(0, 16)}/${path.basename(filePath)}`,
        sha256,
        size: stat.size,
    }
}

function deltaToolPath(): string {
    const executable = process.platform === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper'
    const candidates = [
        path.join(projectRoot, 'packages', 'bootstrapper', 'target', 'release', executable),
        path.join(projectRoot, 'packages', 'bootstrapper', 'target', 'debug', executable),
    ]
    const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!found) throw new Error('A built Rust bootstrapper is required to generate desktop deltas')
    return found
}

async function readPreviousManifest(url: string | undefined): Promise<BootstrapperUpdateManifest | null> {
    if (!url) return null
    const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
    if (response.status === 403 || response.status === 404) return null
    if (!response.ok) throw new Error(`Cannot read previous desktop manifest (${response.status}): ${url}`)
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) throw new Error(`Previous desktop manifest is invalid: ${url}`)
    if (!('schemaVersion' in payload) || payload.schemaVersion !== 3) return null
    const manifest = payload as BootstrapperUpdateManifest
    if (!Number.isSafeInteger(manifest.metadataVersion) || typeof manifest.targets !== 'object' || manifest.targets === null) {
        throw new Error(`Previous desktop manifest is invalid: ${url}`)
    }
    return manifest
}

async function downloadDeltaSource(url: string, targetPath: string): Promise<void> {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Cannot download delta source (${response.status}): ${url}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(targetPath, bytes)
}

function deltaRatioLimit(): number {
    const parsed = Number(process.env.DESKTOP_DELTA_MAX_RATIO ?? '0.7')
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
        throw new Error('DESKTOP_DELTA_MAX_RATIO must be greater than 0 and lower than 1')
    }
    return parsed
}

async function createBsdiffPatch(
    releaseDir: string,
    baseUrl: string,
    dist: string,
    patchPrefix: string,
    patchImmutablePath: string,
    current: ModuleFile,
    previous: VersionedFile | undefined,
): Promise<DeltaArtifact[]> {
    if (!previous || previous.sha256 === current.sha256 || !previous.artifact.url) return []
    const sourcePath = path.join(releaseDir, `.delta-source-${previous.sha256.slice(0, 16)}-${process.pid}.tmp`)
    const patchPath = path.join(releaseDir, `${patchPrefix}-${previous.sha256.slice(0, 16)}-${current.sha256.slice(0, 16)}-${dist}.patch`)
    try {
        await downloadDeltaSource(previous.artifact.url, sourcePath)
        if ((await sha256File(sourcePath)) !== previous.sha256) throw new Error('Downloaded delta source hash does not match previous manifest')
        execFileSync(
            deltaToolPath(),
            ['make-delta', '--provider', 'bsdiff', '--source', sourcePath, '--target', current.artifactPath, '--output', patchPath, '--json'],
            { stdio: 'pipe' },
        )
        const patchSize = fs.statSync(patchPath).size
        if (patchSize >= current.size * deltaRatioLimit()) {
            fs.rmSync(patchPath, { force: true })
            return []
        }
        return [
            {
                provider: 'bsdiff',
                fromSha256: previous.sha256,
                resultSha256: current.sha256,
                resultSize: current.size,
                artifact: await createVersionedArtifactDescriptor(
                    patchPath,
                    baseUrl,
                    path.join(patchImmutablePath, 'patches', 'bsdiff', previous.sha256.slice(0, 16)),
                ),
            },
        ]
    } finally {
        fs.rmSync(sourcePath, { force: true })
    }
}

function createHostArchive(releaseDir: string, packagedAppRootDir: string, version: string, dist: string): string {
    const { platform } = parseDist(dist)
    const hostDir = path.join(packagedAppRootDir, 'host')
    const archivePath = path.join(releaseDir, `pulsesync-host-${version}-${dist}.zip`)
    writeDirectoryZip(hostDir, archivePath, path.basename(hostDir))
    const executableEntry = hostArchiveExecutablePath(platform)
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

type ModuleFile = {
    artifactPath: string
    executable: boolean
    relativePath: string
    sha256: string
    size: number
}

type ModuleArchive = { archivePath: string; contentSha256: string; files: ModuleFile[]; version: string }

function createFileInventory(sourceDir: string, releaseDir: string, artifactPrefix: string, version: string, dist: string): ModuleFile[] {
    const files: ModuleFile[] = []
    const visit = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const sourcePath = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                visit(sourcePath)
                continue
            }
            if (!entry.isFile()) throw new Error(`Component file inventory does not support links: ${sourcePath}`)
            const relativePath = path.relative(sourceDir, sourcePath).replace(/\\/gu, '/')
            const content = fs.readFileSync(sourcePath)
            const sha256 = crypto.createHash('sha256').update(content).digest('hex')
            const artifactPath = path.join(releaseDir, `${artifactPrefix}-${version}-${sha256.slice(0, 16)}-${dist}.bin`)
            fs.copyFileSync(sourcePath, artifactPath)
            const stat = fs.statSync(sourcePath)
            files.push({
                artifactPath,
                executable: (stat.mode & 0o111) !== 0,
                relativePath,
                sha256,
                size: stat.size,
            })
        }
    }
    visit(sourceDir)
    return files
}

function hashDirectory(directory: string): string {
    const hash = crypto.createHash('sha256')
    const files: Array<{ nativeRelative: string; normalizedRelative: string; path: string }> = []
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name)
            if (entry.isDirectory()) {
                visit(entryPath)
                continue
            }
            const nativeRelative = path.relative(directory, entryPath)
            files.push({ nativeRelative, normalizedRelative: nativeRelative.replace(/\\/gu, '/'), path: entryPath })
        }
    }
    visit(directory)
    files.sort((left, right) => (left.nativeRelative < right.nativeRelative ? -1 : left.nativeRelative > right.nativeRelative ? 1 : 0))
    for (const file of files) {
        hash.update(file.normalizedRelative)
        hash.update('\0')
        hash.update(fs.readFileSync(file.path))
        hash.update('\0')
    }
    return hash.digest('hex')
}

function createModuleArchives(releaseDir: string, packagedAppRootDir: string, coreVersion: string, dist: string): Record<string, ModuleArchive> {
    const modulesDir = path.join(packagedAppRootDir, 'modules')
    if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) {
        throw new Error(`Cannot create module artifacts: ${modulesDir} is not a directory`)
    }

    const archives: Record<string, ModuleArchive> = {}
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) {
            throw new Error(`Module payload entry must be a directory: ${path.join(modulesDir, entry.name)}`)
        }
        const match = /^([A-Za-z0-9_]+)-(.+)$/u.exec(entry.name)
        if (!match) throw new Error(`Module payload does not use Discord-style layout: ${entry.name}`)
        const [, moduleName, moduleVersion] = match
        assertModuleName(moduleName)
        if (moduleName === 'desktopCore' && moduleVersion !== coreVersion) {
            throw new Error(`Expected desktopCore-${coreVersion}, got ${entry.name}`)
        }
        const sourceDir = path.join(modulesDir, entry.name, moduleName)
        const archivePath = path.join(releaseDir, `pulsesync-component-${moduleName}-${moduleVersion}-${dist}.zip`)
        writeDirectoryZip(sourceDir, archivePath, moduleName)
        archives[moduleName] = {
            archivePath,
            contentSha256: hashDirectory(sourceDir),
            files: createFileInventory(sourceDir, releaseDir, `pulsesync-component-file-${moduleName}`, moduleVersion, dist),
            version: moduleVersion,
        }
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
    const sourcePath =
        platform === 'darwin'
            ? path.join(packagedAppRootDir, 'PulseSync.app', 'Contents', 'Resources', 'bootstrapper', bootstrapperExecutableName(platform))
            : path.join(packagedAppRootDir, 'bootstrapper', bootstrapperExecutableName(platform))
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
    const metadataVersion = Number(options.metadataVersion)
    if (!Number.isSafeInteger(metadataVersion) || metadataVersion <= 0) {
        throw new Error('metadataVersion must be an explicit positive integer')
    }
    const bundleVersion = String(metadataVersion)
    const previousManifest = await readPreviousManifest(options.previousManifestUrl)
    if (previousManifest && metadataVersion <= previousManifest.metadataVersion) {
        throw new Error(`metadataVersion must be newer than the published manifest (${previousManifest.metadataVersion}), got ${metadataVersion}`)
    }
    const previousTarget = previousManifest?.targets[options.dist]
    const targetHostVersion = options.hostVersion
    const hostArtifactPath = macosBundle
        ? createMacHostBundleArchive(releaseDir, packagedAppRootDir, bundleVersion, options.dist)
        : createHostArchive(releaseDir, packagedAppRootDir, targetHostVersion, options.dist)
    const bootstrapperVersion = readBootstrapperVersion()
    const bootstrapperArtifactPath = macosBundle
        ? null
        : createBootstrapperArtifact(releaseDir, packagedAppRootDir, bootstrapperVersion, options.dist)
    const moduleArchivePaths = macosBundle ? {} : createModuleArchives(releaseDir, packagedAppRootDir, options.coreVersion, options.dist)
    removeStaleBootstrapperArchive(releaseDir, bootstrapperVersion, options.dist)
    removeStaleNativeModulesArchive(releaseDir, options.coreVersion, options.dist)
    removeStaleInstallerAppArtifact(releaseDir, options.coreVersion)

    const hostArtifact = await createVersionedArtifactDescriptor(
        hostArtifactPath,
        baseUrl,
        macosBundle ? path.join('bundles', bundleVersion, options.dist) : path.join('hosts', targetHostVersion, options.dist),
    )
    const hostSourceDir = macosBundle ? null : path.join(packagedAppRootDir, 'host')
    const hostInventory = hostSourceDir ? createFileInventory(hostSourceDir, releaseDir, 'pulsesync-host-file', targetHostVersion, options.dist) : []
    const hostFiles: VersionedFile[] = []
    for (const file of hostInventory) {
        const previousFile = previousTarget?.host.files?.find(previous => previous.path === file.relativePath)
        hostFiles.push({
            path: file.relativePath,
            sha256: file.sha256,
            size: file.size,
            executable: file.executable,
            artifact: await createVersionedArtifactDescriptor(
                file.artifactPath,
                baseUrl,
                path.join('hosts', targetHostVersion, options.dist, 'files'),
            ),
            patches: await createBsdiffPatch(
                releaseDir,
                baseUrl,
                options.dist,
                `pulsesync-host-patch-bsdiff-${targetHostVersion}`,
                path.join('hosts', targetHostVersion, options.dist),
                file,
                previousFile,
            ),
        })
    }
    const bootstrapperArtifact = bootstrapperArtifactPath
        ? await createVersionedArtifactDescriptor(
              bootstrapperArtifactPath,
              baseUrl,
              path.join('components', 'bootstrapper', bootstrapperVersion, options.dist),
          )
        : null
    const electronAbi = fs.readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'abi_version'), 'utf8').trim()
    if (!/^\d+$/u.test(electronAbi)) throw new Error(`Invalid Electron ABI: ${electronAbi}`)
    const components = Object.fromEntries(
        await Promise.all(
            Object.entries(moduleArchivePaths).map(async ([moduleName, moduleArchive]) => {
                const artifact = await createVersionedArtifactDescriptor(
                    moduleArchive.archivePath,
                    baseUrl,
                    path.join('components', moduleName, moduleArchive.version, options.dist),
                )
                const previousFiles = previousTarget?.components[moduleName]?.files ?? []
                const files: VersionedFile[] = []
                for (const file of moduleArchive.files) {
                    const previousFile = previousFiles.find(previous => previous.path === file.relativePath)
                    files.push({
                        path: file.relativePath,
                        sha256: file.sha256,
                        size: file.size,
                        executable: file.executable,
                        artifact: await createVersionedArtifactDescriptor(
                            file.artifactPath,
                            baseUrl,
                            path.join('components', moduleName, moduleArchive.version, options.dist, 'files'),
                        ),
                        patches: await createBsdiffPatch(
                            releaseDir,
                            baseUrl,
                            options.dist,
                            `pulsesync-component-patch-bsdiff-${moduleName}-${moduleArchive.version}`,
                            path.join('components', moduleName, moduleArchive.version, options.dist),
                            file,
                            previousFile,
                        ),
                    })
                }
                return [
                    moduleName,
                    {
                        version: moduleArchive.version,
                        required: true,
                        contentSha256: moduleArchive.contentSha256,
                        files,
                        requiresHost: '>=1.0.0 <2.0.0',
                        ...(moduleName === 'pulsesyncNative' ? { electronAbi } : {}),
                        artifact,
                    },
                ]
            }),
        ),
    )
    if (!macosBundle && !components.desktopCore) {
        throw new Error('desktopCore component artifact is required')
    }
    const manifest: BootstrapperUpdateManifest = {
        schemaVersion: 3,
        metadataVersion,
        channel: options.channel,
        desktopVersion: options.coreVersion,
        bundleVersion,
        desktopApi: DESKTOP_API_VERSION,
        rendererManifestUrl: options.rendererManifestUrl?.trim() || defaultRendererManifestUrl,
        targets: {
            [options.dist]: {
                layout: macosBundle ? 'macos-bundle' : 'versioned-components',
                host: {
                    version: targetHostVersion,
                    required: true,
                    ...(hostSourceDir ? { contentSha256: hashDirectory(hostSourceDir), files: hostFiles, electronAbi } : {}),
                    artifact: hostArtifact,
                },
                components,
                ...(bootstrapperArtifact ? { bootstrapper: { version: bootstrapperVersion, required: true, artifact: bootstrapperArtifact } } : {}),
            },
        },
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
    const coreVersion = readArgValue(args, '--core-version')
    const hostVersion = readArgValue(args, '--host-version')
    const packagedAppRootDir = readArgValue(args, '--packaged-app-root-dir')

    if (!channel || !dist || !coreVersion || !hostVersion || !packagedAppRootDir) {
        throw new Error(
            'Usage: tsx scripts/desktop-release-manifest.ts --channel <name> --dist <platform-arch> --core-version <version> --host-version <version> --metadata-version <number> --packaged-app-root-dir <path> [--release-dir release] [--base-url https://...]',
        )
    }

    const manifestPath = await emitDesktopReleaseManifest({
        baseUrl: resolveBaseUrl(args, channel),
        channel,
        dist,
        packagedAppRootDir,
        releaseDir: readArgValue(args, '--release-dir') || 'release',
        rendererManifestUrl: readArgValue(args, '--renderer-manifest-url') || process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
        coreVersion,
        hostVersion,
        metadataVersion: readArgValue(args, '--metadata-version') || process.env.DESKTOP_METADATA_VERSION,
        previousManifestUrl: readArgValue(args, '--previous-manifest-url') || process.env.DESKTOP_PREVIOUS_MANIFEST_URL,
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
