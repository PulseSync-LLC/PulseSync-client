import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PAGES_BASE_URL = 'https://pulsesync-llc.github.io/PulseSync-renderer/app'

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

function main(): void {
    const sourceRoot = path.resolve(argValue('--source') || '')
    const targetRoot = path.resolve(argValue('--target') || '')
    const pagesBaseUrl = (argValue('--base-url') || DEFAULT_PAGES_BASE_URL).replace(/\/+$/u, '')

    if (!argValue('--source') || !argValue('--target')) {
        throw new Error('Usage: tsx scripts/renderer/stage-pages-repository.ts --source <build-root> --target <repository-root>')
    }
    if (sourceRoot === targetRoot) {
        throw new Error('Pages build source and repository target must be different directories')
    }

    const sourceApp = path.join(sourceRoot, 'app')
    const targetApp = path.join(targetRoot, 'app')
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

    fs.mkdirSync(targetApp, { recursive: true })
    fs.cpSync(sourceApp, targetApp, { recursive: true, force: true })
    fs.writeFileSync(path.join(targetRoot, '.nojekyll'), '')

    console.log(`Staged GitHub Pages renderer ${manifest.buildNumber}: ${targetApp}`)
    console.log(`GitHub Pages renderer URL: ${manifest.url}`)
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
}
