import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'
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
const FINGERPRINT_BUILD_NUMBER = '0'
const RENDERER_CHANNELS = ['dev', 'beta'] as const

type RendererChannel = (typeof RENDERER_CHANNELS)[number]

type RemoteRendererBuildOptions = {
    buildNumber: string
    channel: RendererChannel
    cdnBaseUrl: string
    outRoot: string
}

type RendererManifest = {
    artifactSha256?: string
    buildNumber: string
    requiresDesktopApi: string
    url: string
}

type RemoteRendererBuildResult = {
    artifactSha256: string
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

function normalizeRendererChannel(value: string): RendererChannel {
    const normalized = value.trim().toLowerCase()
    if (!RENDERER_CHANNELS.includes(normalized as RendererChannel)) {
        throw new Error(`Renderer channel must be dev or beta, got: ${value}`)
    }
    return normalized as RendererChannel
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

function walkFiles(directory: string): string[] {
    return fs.readdirSync(directory).flatMap(entry => {
        const entryPath = path.join(directory, entry)
        return fs.statSync(entryPath).isDirectory() ? walkFiles(entryPath) : [entryPath]
    })
}

function hashRendererArtifact(outRoot: string, manifestPath: string): string {
    const hash = crypto.createHash('sha256')
    const files = walkFiles(outRoot)
        .filter(filePath => filePath !== manifestPath)
        .sort((left, right) => left.localeCompare(right))

    for (const filePath of files) {
        hash.update(path.relative(outRoot, filePath).replace(/\\/gu, '/'))
        hash.update('\0')
        hash.update(fs.readFileSync(filePath))
        hash.update('\0')
    }
    hash.update(`requiresDesktopApi=^${DESKTOP_API_VERSION}`)
    return hash.digest('hex')
}

async function readPublishedManifest(options: RemoteRendererBuildOptions): Promise<RendererManifest | null> {
    const manifestUrl = `${joinUrl(options.cdnBaseUrl, 'desktop', 'manifest.json')}?_=${Date.now()}`
    const response = await fetch(manifestUrl, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
    })
    if (response.status === 403 || response.status === 404) return null
    if (!response.ok) throw new Error(`Cannot read published renderer manifest (${response.status}): ${manifestUrl}`)

    const manifest = (await response.json()) as Partial<RendererManifest>
    if (typeof manifest.buildNumber !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(manifest.buildNumber)) {
        throw new Error(`Published renderer manifest has an invalid buildNumber: ${String(manifest.buildNumber)}`)
    }
    if (typeof manifest.requiresDesktopApi !== 'string' || typeof manifest.url !== 'string') {
        throw new Error(`Published renderer manifest is invalid: ${manifestUrl}`)
    }
    if (manifest.artifactSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(manifest.artifactSha256)) {
        throw new Error(`Published renderer manifest has an invalid artifactSha256: ${manifestUrl}`)
    }
    return manifest as RendererManifest
}

function writePublishOutputs(changed: boolean, buildNumber: string, artifactSha256: string): void {
    const outputPath = process.env.GITHUB_OUTPUT?.trim()
    if (!outputPath) return
    fs.appendFileSync(outputPath, `changed=${changed}\nbuild_number=${buildNumber}\nartifact_sha256=${artifactSha256}\n`, 'utf8')
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

async function buildRemoteRenderer(options: RemoteRendererBuildOptions, artifactSha256Override?: string): Promise<RemoteRendererBuildResult> {
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
    const artifactSha256 = artifactSha256Override ?? hashRendererArtifact(options.outRoot, manifestPath)

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
            {
                buildNumber: options.buildNumber,
                url: rendererUrl,
                requiresDesktopApi: `^${DESKTOP_API_VERSION}`,
                artifactSha256,
            },
            null,
            4,
        )}\n`,
    )

    console.log(`Remote renderer build ${options.buildNumber}: ${buildOutDir}`)
    console.log(`Remote renderer URL: ${rendererUrl}`)
    console.log(`Remote renderer manifest: ${manifestUrl}`)
    console.log(`Remote renderer artifact SHA-256: ${artifactSha256}`)
    return { artifactSha256 }
}

function readBuildOptions(): RemoteRendererBuildOptions {
    const channel = normalizeRendererChannel(argValue('--channel') || process.env.PULSESYNC_REMOTE_RENDERER_CHANNEL || 'dev')
    return {
        buildNumber: resolveBuildNumber(),
        channel,
        cdnBaseUrl: normalizeCdnBaseUrl(
            argValue('--cdn-url') || process.env.PULSESYNC_REMOTE_RENDERER_CDN_URL || joinUrl(DEFAULT_CDN_BASE_URL, channel),
        ),
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
            const fingerprintOptions = { ...options, buildNumber: FINGERPRINT_BUILD_NUMBER }
            const fingerprintBuild = await buildRemoteRenderer(fingerprintOptions)
            const publishedManifest = await readPublishedManifest(options)
            if (publishedManifest?.artifactSha256 === fingerprintBuild.artifactSha256) {
                console.log(
                    `Remote renderer artifact is unchanged; keeping published build ${publishedManifest.buildNumber} (${fingerprintBuild.artifactSha256})`,
                )
                writePublishOutputs(false, publishedManifest.buildNumber, fingerprintBuild.artifactSha256)
                return
            }

            await buildRemoteRenderer(options, fingerprintBuild.artifactSha256)
        }

        const prefix = argValue('--prefix') || process.env.PULSESYNC_REMOTE_RENDERER_S3_PREFIX || `${DEFAULT_S3_PREFIX}/${options.channel}`
        await uploadRemoteRendererGlitchTipSourceMaps(options.buildNumber, joinUrl(options.cdnBaseUrl, 'versions', options.buildNumber))
        const publishPlan = await publishDirectoryToS3(options.outRoot, { prefix })
        writePublishOutputs(true, publishPlan.buildNumber, publishPlan.artifactSha256)
        return
    }

    console.error(
        [
            'Usage: tsx scripts/renderer/remote-renderer.ts <build|publish>',
            'Options:',
            '  --channel <dev|beta>         Default: dev',
            '  --cdn-url <url>              Default: https://pulsesync.dev/app/<channel>',
            '  --out-dir <dir>             Default: out/remote-renderer',
            '  --build-number <integer>    Independent renderer build number',
            '  --prefix <s3-prefix>         Publish only, default: app/<channel>',
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
