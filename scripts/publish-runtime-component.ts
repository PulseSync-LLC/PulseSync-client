import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as viteBuild } from 'vite'

import { componentContainerName, readRuntimeComponentMetadata } from './component-layout.js'
import { emitRuntimeComponentUpdateManifest, getDesktopHybridReleaseManifestName, getDesktopReleaseManifestName } from './desktop-release-manifest.js'
import { fetchWithRetry } from './network-retry.js'
import { publishToS3 } from './s3-upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_REPOSITORY = 'PulseSync-LLC/PulseSync-client'
const DEFAULT_S3_URL = 'https://s3.pulsesync.dev'
const COMPONENTS = ['desktopCore', 'artifactWorker', 'pulsesyncNative', 'bootstrapper'] as const
type RuntimeComponentName = (typeof COMPONENTS)[number]

function argValue(args: string[], flag: string): string | null {
    const index = args.indexOf(flag)
    return index === -1 ? null : args[index + 1] || null
}

function requiredArg(args: string[], flag: string): string {
    const value = argValue(args, flag)
    if (!value) throw new Error(`${flag} is required`)
    return value
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}): void {
    const result = spawnSync(command, args, {
        cwd: options.cwd || projectRoot,
        env: { ...process.env, ...options.env },
        stdio: options.quiet ? 'pipe' : 'inherit',
        windowsHide: true,
    })
    if (result.status !== 0) {
        const detail = options.quiet
            ? Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)])
                  .toString('utf8')
                  .trim()
            : ''
        throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`)
    }
}

function commandOutput(command: string, args: string[]): string {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        env: process.env,
        windowsHide: true,
    })
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}: ${(result.stderr || result.stdout).trim()}`)
    }
    return result.stdout.trim()
}

function tsxArgs(script: string, args: string[]): string[] {
    return [path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args]
}

function getDist(): string {
    return process.platform === 'darwin' ? 'darwin-universal' : `${process.platform}-${process.arch}`
}

function manifestName(dist: string): string {
    return dist.startsWith('darwin-') ? getDesktopHybridReleaseManifestName(dist) : getDesktopReleaseManifestName(dist)
}

async function readManifest(url: string): Promise<any> {
    const separator = url.includes('?') ? '&' : '?'
    const response = await fetchWithRetry(
        `${url}${separator}_=${Date.now()}`,
        { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } },
        { label: 'runtime component manifest' },
    )
    if (!response.ok) throw new Error(`Cannot read published manifest (${response.status}): ${url}`)
    const value = (await response.json()) as any
    if (!value || typeof value !== 'object' || !value.targets || typeof value.targets !== 'object') {
        throw new Error(`Published manifest is invalid: ${url}`)
    }
    return value
}

function copyFileIntoModule(source: string, moduleDir: string, fileName = path.basename(source)): void {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Built component file is missing: ${source}`)
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.copyFileSync(source, path.join(moduleDir, fileName))
}

async function buildArtifactWorker(moduleDir: string): Promise<void> {
    await viteBuild({
        configFile: path.join(projectRoot, 'vite.worker.config.ts'),
        mode: 'production',
    })
    copyFileIntoModule(path.join(projectRoot, '.vite', 'worker', 'artifactWorker.cjs'), moduleDir)
}

function buildPulsesyncNative(moduleDir: string): void {
    const nativeRoot = path.join(projectRoot, 'nativeModules', 'pulsesyncNative')
    const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
    run(yarnCommand, ['build'], { cwd: nativeRoot })
    copyFileIntoModule(path.join(nativeRoot, 'build', 'Release', 'pulsesyncNative.node'), moduleDir)
}

function restoreFiles(snapshots: Map<string, Buffer>): void {
    for (const [file, contents] of snapshots) fs.writeFileSync(file, contents)
}

function buildDesktopCore(channel: string, metadataVersion: string): string {
    const trackedFiles = [path.join(projectRoot, 'packages', 'desktop-core', 'package.json'), path.join(projectRoot, 'src', 'common', 'appConfig.ts')]
    const snapshots = new Map(trackedFiles.map(file => [file, fs.readFileSync(file)]))
    try {
        run(process.execPath, tsxArgs('scripts/build.ts', ['--core', '--publish', channel, '--debug']), {
            env: { DESKTOP_METADATA_VERSION: metadataVersion },
        })
    } finally {
        restoreFiles(snapshots)
    }
    return path.join(projectRoot, 'release', 'desktop-core')
}

function buildBootstrapper(channel: string, dist: string, metadataVersion: string): string {
    run(process.execPath, tsxArgs('scripts/bootstrapper/build.ts', ['publish', '--channel', channel, '--dist', dist]), {
        env: { DESKTOP_METADATA_VERSION: metadataVersion },
    })
    return path.join(projectRoot, 'release', 'bootstrapper')
}

async function buildAuxiliaryComponent(
    componentName: 'artifactWorker' | 'pulsesyncNative',
    channel: string,
    dist: string,
    metadataVersion: string,
    baseUrl: string,
): Promise<string> {
    const publishedManifestUrl = `${baseUrl}/${manifestName(dist)}`
    const previousManifest = await readManifest(publishedManifestUrl)
    const previousTarget = previousManifest.targets[dist]
    if (!previousTarget) throw new Error(`Published manifest has no target: ${dist}`)
    const previousComponent = previousTarget.components?.[componentName]
    const previousRevision = previousComponent?.revision
    if (!Number.isSafeInteger(previousRevision) || previousRevision <= 0) {
        throw new Error(`Published ${componentName} revision is invalid for ${dist}`)
    }
    process.env.PULSESYNC_COMPONENT_REVISIONS = JSON.stringify({ [componentName]: previousRevision + 1 })
    const component = readRuntimeComponentMetadata(projectRoot)[componentName]
    const outputRoot = path.join(projectRoot, 'out', 'runtime-component', dist, componentName)
    const moduleDir = path.join(outputRoot, componentContainerName(component), component.diskName)
    const releaseDir = path.join(projectRoot, 'release', 'runtime-component', dist)
    fs.rmSync(outputRoot, { force: true, recursive: true })
    fs.rmSync(releaseDir, { force: true, recursive: true })
    if (componentName === 'artifactWorker') await buildArtifactWorker(moduleDir)
    else buildPulsesyncNative(moduleDir)

    const generatedManifest = await emitRuntimeComponentUpdateManifest({
        baseUrl,
        channel,
        componentModuleDir: moduleDir,
        componentName,
        dist,
        metadataVersion,
        previousManifestUrl: publishedManifestUrl,
        releaseDir,
    })
    await publishToS3(channel, releaseDir, previousManifest.desktopVersion, { keepRecentVersions: null })
    return path.dirname(generatedManifest)
}

function selectedDescriptor(manifest: any, dist: string, component: RuntimeComponentName): any {
    const target = manifest.targets?.[dist]
    if (!target) throw new Error(`Generated manifest has no target: ${dist}`)
    const descriptor = component === 'bootstrapper' ? target.bootstrapper : target.components?.[component]
    if (!descriptor?.artifact?.url) throw new Error(`Generated manifest has no ${component} artifact for ${dist}`)
    return descriptor
}

function releaseAssetFromDescriptor(releaseDir: string, descriptor: any): string {
    const fileName = decodeURIComponent(new URL(descriptor.artifact.url).pathname.split('/').filter(Boolean).at(-1) || '')
    const candidate = path.join(releaseDir, fileName)
    if (!fileName || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        throw new Error(`Generated component archive is missing: ${candidate}`)
    }
    return candidate
}

function publishGitHub(repository: string, tag: string, channel: string, targetRoot: string): void {
    const gh = process.platform === 'win32' ? 'gh.exe' : 'gh'
    const existing = spawnSync(gh, ['release', 'view', tag, '--repo', repository], { cwd: projectRoot, stdio: 'ignore', windowsHide: true })
    if (existing.status !== 0) {
        const targetCommit = process.env.GITHUB_SHA?.trim() || commandOutput('git', ['rev-parse', 'HEAD'])
        const createArgs = [
            'release',
            'create',
            tag,
            '--repo',
            repository,
            '--title',
            `Runtime components ${tag}`,
            '--notes',
            '',
            '--latest=false',
            '--target',
            targetCommit,
        ]
        if (channel !== 'beta') createArgs.push('--prerelease')
        run(gh, createArgs)
    }
    run(gh, ['release', 'upload', tag, '--repo', repository, '--clobber', ...fs.readdirSync(targetRoot).map(name => path.join(targetRoot, name))])
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const component = requiredArg(args, '--component') as RuntimeComponentName
    const channel = requiredArg(args, '--channel').toLowerCase()
    const repository = argValue(args, '--repository') || DEFAULT_REPOSITORY
    const metadataVersion = argValue(args, '--metadata-version') || process.env.DESKTOP_METADATA_VERSION?.trim() || String(Date.now())
    const parsedMetadataVersion = Number(metadataVersion)
    const dist = getDist()
    if (!COMPONENTS.includes(component)) throw new Error(`Unsupported runtime component: ${component}`)
    if (!['beta', 'dev'].includes(channel)) throw new Error(`Unsupported update channel: ${channel}`)
    if (!/^\d+$/u.test(metadataVersion) || !Number.isSafeInteger(parsedMetadataVersion) || parsedMetadataVersion <= 0) {
        throw new Error(`Invalid metadata version: ${metadataVersion}`)
    }
    const packageVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'packages', 'desktop-core', 'package.json'), 'utf8')).version as string
    const baseVersion = packageVersion.split('-')[0]
    const tag = argValue(args, '--github-tag') || `v${baseVersion}-${channel}.components.${metadataVersion}`
    run(
        process.execPath,
        tsxArgs(path.join(projectRoot, 'scripts', 'github-release-runtime.ts'), [
            'check-component-base',
            '--repository',
            repository,
            '--tag',
            tag,
            '--channel',
            channel,
            '--dist',
            dist,
        ]),
    )

    const baseUrl = `${(process.env.S3_URL?.trim() || DEFAULT_S3_URL).replace(/\/+$/u, '')}/builds/app/${channel}`
    let releaseDir: string
    if (component !== 'bootstrapper') {
        run('cargo', ['build', '--manifest-path', path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')])
    }
    if (component === 'desktopCore') releaseDir = buildDesktopCore(channel, metadataVersion)
    else if (component === 'bootstrapper') releaseDir = buildBootstrapper(channel, dist, metadataVersion)
    else releaseDir = await buildAuxiliaryComponent(component, channel, dist, metadataVersion, baseUrl)

    const generatedManifestFile = path.join(releaseDir, manifestName(dist))
    const generatedManifest = JSON.parse(fs.readFileSync(generatedManifestFile, 'utf8')) as any
    const descriptor = selectedDescriptor(generatedManifest, dist, component)
    const sourceAsset = releaseAssetFromDescriptor(releaseDir, descriptor)
    const githubTarget = path.join(projectRoot, 'out', 'component-github-release', dist)
    run(
        process.execPath,
        tsxArgs(path.join(projectRoot, 'scripts', 'github-release-runtime.ts'), [
            'prepare-component',
            '--source-manifest',
            generatedManifestFile,
            '--source-asset',
            sourceAsset,
            '--target',
            githubTarget,
            '--repository',
            repository,
            '--tag',
            tag,
            '--channel',
            channel,
            '--dist',
            dist,
            '--component',
            component,
        ]),
    )

    if (args.includes('--publish-github')) publishGitHub(repository, tag, channel, githubTarget)
    console.log(`Runtime component published: ${component} (${channel}/${dist})`)
    console.log(`GitHub tag: ${tag}`)
    console.log(`GitHub assets: ${githubTarget}`)
    if (!args.includes('--publish-github')) {
        console.log(
            `Upload manually: gh release create ${tag} --repo ${repository} ${channel === 'beta' ? '' : '--prerelease '}"${githubTarget}${path.sep}*"`,
        )
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
})
