import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import { DESKTOP_API_VERSION } from '../../src/common/desktopApi/version.js'
import { publishDirectoryToS3 } from '../s3-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const DEFAULT_CDN_BASE_URL = 'https://pulsesync.dev/app'
const DEFAULT_OUT_ROOT = path.resolve(projectRoot, 'out/remote-renderer')
const DEFAULT_S3_PREFIX = 'app'

type PackageJson = {
    version?: string
}

type RemoteRendererBuildOptions = {
    cdnBaseUrl: string
    outRoot: string
    rendererVersion: string
    minClientVersion?: string
}

function readPackageJson(): PackageJson {
    const raw = fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8')
    return JSON.parse(raw) as PackageJson
}

function readGitShortSha(): string {
    try {
        return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim()
    } catch {
        return 'local'
    }
}

function argValue(flag: string): string | null {
    const index = process.argv.indexOf(flag)
    if (index === -1) return null
    return process.argv[index + 1] || null
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag)
}

function normalizeCdnBaseUrl(value: string): string {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/u, '')
    return url.toString().replace(/\/+$/u, '')
}

function joinUrl(baseUrl: string, ...segments: string[]): string {
    const base = `${baseUrl.replace(/\/+$/u, '')}/`
    return new URL(segments.map(segment => segment.replace(/^\/+|\/+$/gu, '')).join('/'), base).toString()
}

function toUrlPathBase(cdnBaseUrl: string, rendererVersion: string): string {
    const url = new URL(cdnBaseUrl)
    const basePath = url.pathname.replace(/^\/+|\/+$/gu, '')
    const fullPath = [basePath, 'versions', rendererVersion].filter(Boolean).join('/')
    return `/${fullPath}/`
}

function toPathSegment(value: string): string {
    return value.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'local'
}

function normalizeRendererHtmlOutput(versionOutDir: string): void {
    const nestedHtmlPath = path.join(versionOutDir, 'src/renderer/index.html')
    const rootHtmlPath = path.join(versionOutDir, 'index.html')
    if (!fs.existsSync(nestedHtmlPath)) {
        return
    }

    fs.renameSync(nestedHtmlPath, rootHtmlPath)
    fs.rmSync(path.join(versionOutDir, 'src'), { force: true, recursive: true })
}

function resolveRendererVersion(packageJson: PackageJson): string {
    const explicitVersion = process.env.PULSESYNC_REMOTE_RENDERER_VERSION?.trim()
    if (explicitVersion) {
        return toPathSegment(explicitVersion)
    }

    const packageVersion = packageJson.version?.trim() || '0.0.0'
    return toPathSegment(`${packageVersion}-${readGitShortSha()}`)
}

async function buildRemoteRenderer(options: RemoteRendererBuildOptions): Promise<void> {
    const versionOutDir = path.join(options.outRoot, 'versions', options.rendererVersion)
    const manifestDir = path.join(options.outRoot, 'desktop')
    const manifestPath = path.join(manifestDir, 'manifest.json')
    const rendererUrl = joinUrl(options.cdnBaseUrl, 'versions', options.rendererVersion, 'index.html')
    const manifestUrl = joinUrl(options.cdnBaseUrl, 'desktop', 'manifest.json')

    fs.rmSync(options.outRoot, { force: true, recursive: true })
    fs.mkdirSync(manifestDir, { recursive: true })

    process.env.PULSESYNC_REMOTE_RENDERER_BUILD = '1'
    process.env.PULSESYNC_REMOTE_RENDERER_OUT_DIR = versionOutDir
    process.env.PULSESYNC_REMOTE_RENDERER_STATIC_ASSETS_DIR = path.join(options.outRoot, 'assets')
    process.env.PULSESYNC_REMOTE_RENDERER_BASE = toUrlPathBase(options.cdnBaseUrl, options.rendererVersion)

    await viteBuild({
        configFile: path.resolve(projectRoot, 'vite.renderer.config.ts'),
        mode: 'production',
    })
    normalizeRendererHtmlOutput(versionOutDir)

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
            {
                rendererVersion: options.rendererVersion,
                url: rendererUrl,
                requiresDesktopApi: `^${DESKTOP_API_VERSION}`,
                ...(options.minClientVersion ? { minClientVersion: options.minClientVersion } : {}),
            },
            null,
            4,
        )}\n`,
    )

    console.log(`Remote renderer built: ${versionOutDir}`)
    console.log(`Remote renderer URL: ${rendererUrl}`)
    console.log(`Remote renderer manifest: ${manifestUrl}`)
}

function readBuildOptions(): RemoteRendererBuildOptions {
    const packageJson = readPackageJson()
    return {
        cdnBaseUrl: normalizeCdnBaseUrl(argValue('--cdn-url') || process.env.PULSESYNC_REMOTE_RENDERER_CDN_URL || DEFAULT_CDN_BASE_URL),
        outRoot: path.resolve(projectRoot, argValue('--out-dir') || process.env.PULSESYNC_REMOTE_RENDERER_OUT_DIR_ROOT || DEFAULT_OUT_ROOT),
        rendererVersion: resolveRendererVersion(packageJson),
        minClientVersion: argValue('--min-client-version') || process.env.PULSESYNC_REMOTE_RENDERER_MIN_CLIENT_VERSION,
    }
}

async function cli(): Promise<void> {
    const command = process.argv[2] || 'build'
    const options = readBuildOptions()

    if (command === 'build') {
        await buildRemoteRenderer(options)
        return
    }

    if (command === 'publish') {
        if (!hasFlag('--no-build')) {
            await buildRemoteRenderer(options)
        }

        const prefix = argValue('--prefix') || process.env.PULSESYNC_REMOTE_RENDERER_S3_PREFIX || DEFAULT_S3_PREFIX
        await publishDirectoryToS3(options.outRoot, { prefix })
        return
    }

    console.error(
        [
            'Usage: tsx scripts/renderer/remote-renderer.ts <build|publish>',
            'Options:',
            '  --cdn-url <url>             Default: https://pulsesync.dev/app',
            '  --out-dir <dir>             Default: out/remote-renderer',
            '  --prefix <s3-prefix>        Publish only, default: app',
            '  --min-client-version <ver>  Optional manifest guard',
            '  --no-build                  Publish existing out dir',
        ].join('\n'),
    )
    process.exit(1)
}

cli().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
})
