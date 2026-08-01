import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PAGES_BASE_URL = 'https://static.pulsesync.dev/app'
const PAGES_CUSTOM_DOMAIN = 'static.pulsesync.dev'
const RENDERER_CHANNELS = ['dev', 'beta'] as const

type RendererChannel = (typeof RENDERER_CHANNELS)[number]

type RendererManifest = {
    buildNumber: string
    requiresDesktopApi: string
    url: string
}

function argValue(flag: string): string | null {
    const index = process.argv.indexOf(flag)
    if (index === -1) return null
    return process.argv[index + 1] || null
}

function requireDirectory(directoryPath: string, label: string): void {
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
        throw new Error(`${label} directory does not exist: ${directoryPath}`)
    }
}

function readManifest(manifestPath: string): RendererManifest {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<RendererManifest>
    if (typeof value.buildNumber !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value.buildNumber)) {
        throw new Error(`Renderer manifest has an invalid buildNumber: ${manifestPath}`)
    }
    if (typeof value.requiresDesktopApi !== 'string' || !value.requiresDesktopApi.trim()) {
        throw new Error(`Renderer manifest has an invalid requiresDesktopApi: ${manifestPath}`)
    }
    if (typeof value.url !== 'string') {
        throw new Error(`Renderer manifest has an invalid URL: ${manifestPath}`)
    }
    return value as RendererManifest
}

function parseRetainVersions(): number {
    const rawValue = argValue('--retain-versions') || '5'
    const value = Number(rawValue)
    if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
        throw new Error(`Invalid --retain-versions value: ${rawValue}`)
    }
    return value
}

function parseRendererChannel(): RendererChannel {
    const rawValue = argValue('--channel') || ''
    const channel = rawValue.trim().toLowerCase()
    if (!RENDERER_CHANNELS.includes(channel as RendererChannel)) {
        throw new Error(`Invalid --channel value: ${rawValue}; expected dev or beta`)
    }
    return channel as RendererChannel
}

function mirrorAppEntries(sourceApp: string, targetApp: string): void {
    fs.mkdirSync(targetApp, { recursive: true })
    for (const entry of fs.readdirSync(targetApp, { withFileTypes: true })) {
        if (entry.name === 'versions' && entry.isDirectory()) continue
        fs.rmSync(path.join(targetApp, entry.name), { force: true, recursive: true })
    }
    for (const entry of fs.readdirSync(sourceApp, { withFileTypes: true })) {
        const sourceEntry = path.join(sourceApp, entry.name)
        const targetEntry = path.join(targetApp, entry.name)
        if (entry.name === 'versions' && entry.isDirectory()) {
            fs.mkdirSync(targetEntry, { recursive: true })
            for (const versionEntry of fs.readdirSync(sourceEntry, { withFileTypes: true })) {
                const targetVersion = path.join(targetEntry, versionEntry.name)
                fs.rmSync(targetVersion, { force: true, recursive: true })
                fs.cpSync(path.join(sourceEntry, versionEntry.name), targetVersion, { recursive: true, force: true })
            }
            continue
        }
        fs.rmSync(targetEntry, { force: true, recursive: true })
        fs.cpSync(sourceEntry, targetEntry, { recursive: true, force: true })
    }
}

function pruneRendererVersions(targetApp: string, currentBuildNumber: string, retainVersions: number): string[] {
    const versionsRoot = path.join(targetApp, 'versions')
    requireDirectory(versionsRoot, 'Pages renderer versions')
    const versions = fs
        .readdirSync(versionsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    const invalidVersion = versions.find(version => !/^(?:0|[1-9]\d*)$/u.test(version))
    if (invalidVersion) throw new Error(`Unexpected renderer version directory: ${invalidVersion}`)

    versions.sort((left, right) => (BigInt(left) > BigInt(right) ? -1 : BigInt(left) < BigInt(right) ? 1 : 0))
    const retained = new Set<string>([currentBuildNumber])
    for (const version of versions) {
        if (retained.size >= retainVersions) break
        retained.add(version)
    }

    const removed: string[] = []
    for (const version of versions) {
        if (retained.has(version)) continue
        fs.rmSync(path.join(versionsRoot, version), { force: true, recursive: true })
        removed.push(version)
    }
    return removed
}

function main(): void {
    const sourceRoot = path.resolve(argValue('--source') || '')
    const targetRoot = path.resolve(argValue('--target') || '')
    const channel = parseRendererChannel()
    const pagesBaseUrl = (argValue('--base-url') || `${DEFAULT_PAGES_BASE_URL}/${channel}`).replace(/\/+$/u, '')
    const retainVersions = parseRetainVersions()

    if (!argValue('--source') || !argValue('--target')) {
        throw new Error(
            'Usage: tsx scripts/renderer/stage-pages-repository.ts --source <build-root> --target <repository-root> --channel <dev|beta> [--retain-versions <count>]',
        )
    }
    if (sourceRoot === targetRoot) {
        throw new Error('Pages build source and repository target must be different directories')
    }

    const sourceApp = path.join(sourceRoot, 'app', channel)
    const targetApp = path.join(targetRoot, 'app', channel)
    requireDirectory(sourceApp, 'Pages renderer source')
    requireDirectory(path.join(targetRoot, '.git'), 'Pages renderer Git repository')

    const manifestPath = path.join(sourceApp, 'desktop', 'manifest.json')
    const manifest = readManifest(manifestPath)
    const expectedRendererUrl = `${pagesBaseUrl}/versions/${manifest.buildNumber}/index.html`
    if (manifest.url !== expectedRendererUrl) {
        throw new Error(`Renderer manifest URL mismatch: expected ${expectedRendererUrl}, got ${manifest.url}`)
    }

    const versionEntry = path.join(sourceApp, 'versions', manifest.buildNumber, 'index.html')
    if (!fs.existsSync(versionEntry) || !fs.statSync(versionEntry).isFile()) {
        throw new Error(`Renderer version entry does not exist: ${versionEntry}`)
    }

    mirrorAppEntries(sourceApp, targetApp)
    const removedVersions = pruneRendererVersions(targetApp, manifest.buildNumber, retainVersions)
    fs.writeFileSync(path.join(targetRoot, '.nojekyll'), '')
    fs.writeFileSync(path.join(targetRoot, 'CNAME'), `${PAGES_CUSTOM_DOMAIN}\n`, 'utf8')

    console.log(`Staged GitHub Pages renderer ${channel}/${manifest.buildNumber}: ${targetApp}`)
    console.log(`GitHub Pages renderer URL: ${manifest.url}`)
    console.log(`Renderer retention: kept up to ${retainVersions}, removed ${removedVersions.length}`)
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
}
