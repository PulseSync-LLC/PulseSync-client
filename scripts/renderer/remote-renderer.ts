import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import { DESKTOP_API_VERSION } from '../../src/common/desktopApi/version.js'
import {
    assertGlitchTipSourceMapConfig,
    prepareRemoteRendererGlitchTipSourceMaps,
    uploadRemoteRendererGlitchTipSourceMaps,
} from '../glitchtip-sourcemaps.js'
import { publishDirectoryToS3 } from '../s3-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const DEFAULT_CDN_BASE_URL = 'https://pulsesync.dev/app'
const DEFAULT_OUT_ROOT = path.resolve(projectRoot, 'out/remote-renderer')
const DEFAULT_S3_PREFIX = 'app'

type RemoteRendererBuildOptions = {
    buildNumber: string
    cdnBaseUrl: string
    outRoot: string
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

function toUrlPathBase(cdnBaseUrl: string, buildNumber: string): string {
    const url = new URL(cdnBaseUrl)
    const basePath = url.pathname.replace(/^\/+|\/+$/gu, '')
    const fullPath = [basePath, 'versions', buildNumber].filter(Boolean).join('/')
    return `/${fullPath}/`
}

function normalizeBuildNumber(value: string, source: string): string {
    const normalized = value.trim()
    if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
        throw new Error(`${source} must be a non-negative integer, got: ${value}`)
    }
    return normalized
}

function normalizeRendererHtmlOutput(buildOutDir: string): void {
    const nestedHtmlPath = path.join(buildOutDir, 'src/renderer/index.html')
    const rootHtmlPath = path.join(buildOutDir, 'index.html')
    if (!fs.existsSync(nestedHtmlPath)) {
        return
    }

    fs.renameSync(nestedHtmlPath, rootHtmlPath)
    fs.rmSync(path.join(buildOutDir, 'src'), { force: true, recursive: true })
}

function resolveBuildNumber(): string {
    const cliBuildNumber = argValue('--build-number')
    if (cliBuildNumber) {
        return normalizeBuildNumber(cliBuildNumber, '--build-number')
    }

    const environmentBuildNumber = process.env.PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER
    if (environmentBuildNumber?.trim()) {
        return normalizeBuildNumber(environmentBuildNumber, 'PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER')
    }

    return String(Date.now())
}

async function buildRemoteRenderer(options: RemoteRendererBuildOptions): Promise<void> {
    const buildOutDir = path.join(options.outRoot, 'versions', options.buildNumber)
    const manifestDir = path.join(options.outRoot, 'desktop')
    const manifestPath = path.join(manifestDir, 'manifest.json')
    const rendererUrl = joinUrl(options.cdnBaseUrl, 'versions', options.buildNumber, 'index.html')
    const manifestUrl = joinUrl(options.cdnBaseUrl, 'desktop', 'manifest.json')

    fs.rmSync(options.outRoot, { force: true, recursive: true })
    fs.mkdirSync(manifestDir, { recursive: true })

    process.env.PULSESYNC_REMOTE_RENDERER_BUILD = '1'
    process.env.PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER = options.buildNumber
    process.env.PULSESYNC_REMOTE_RENDERER_OUT_DIR = buildOutDir
    process.env.PULSESYNC_REMOTE_RENDERER_STATIC_ASSETS_DIR = path.join(options.outRoot, 'assets')
    process.env.PULSESYNC_REMOTE_RENDERER_BASE = toUrlPathBase(options.cdnBaseUrl, options.buildNumber)

    await viteBuild({
        configFile: path.resolve(projectRoot, 'vite.renderer.config.ts'),
        mode: 'production',
    })
    normalizeRendererHtmlOutput(buildOutDir)
    prepareRemoteRendererGlitchTipSourceMaps(buildOutDir)

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
            {
                buildNumber: options.buildNumber,
                url: rendererUrl,
                requiresDesktopApi: `^${DESKTOP_API_VERSION}`,
            },
            null,
            4,
        )}\n`,
    )

    console.log(`Remote renderer build ${options.buildNumber}: ${buildOutDir}`)
    console.log(`Remote renderer URL: ${rendererUrl}`)
    console.log(`Remote renderer manifest: ${manifestUrl}`)
}

function readBuildOptions(): RemoteRendererBuildOptions {
    return {
        buildNumber: resolveBuildNumber(),
        cdnBaseUrl: normalizeCdnBaseUrl(argValue('--cdn-url') || process.env.PULSESYNC_REMOTE_RENDERER_CDN_URL || DEFAULT_CDN_BASE_URL),
        outRoot: path.resolve(projectRoot, argValue('--out-dir') || process.env.PULSESYNC_REMOTE_RENDERER_OUT_DIR_ROOT || DEFAULT_OUT_ROOT),
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
        assertGlitchTipSourceMapConfig()
        if (!hasFlag('--no-build')) {
            await buildRemoteRenderer(options)
        }

        const prefix = argValue('--prefix') || process.env.PULSESYNC_REMOTE_RENDERER_S3_PREFIX || DEFAULT_S3_PREFIX
        await uploadRemoteRendererGlitchTipSourceMaps(options.buildNumber, joinUrl(options.cdnBaseUrl, 'versions', options.buildNumber))
        await publishDirectoryToS3(options.outRoot, { prefix })
        return
    }

    console.error(
        [
            'Usage: tsx scripts/renderer/remote-renderer.ts <build|publish>',
            'Options:',
            '  --cdn-url <url>             Default: https://pulsesync.dev/app',
            '  --out-dir <dir>             Default: out/remote-renderer',
            '  --build-number <integer>    Independent renderer build number',
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
