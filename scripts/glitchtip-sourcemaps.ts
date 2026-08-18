import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDesktopErrorTrackingRelease, getRendererErrorTrackingRelease } from '../src/common/errorTrackingRelease.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(__dirname, '..', '.glitchtip-sourcemaps')
const desktopStagingRoot = path.join(stagingRoot, 'desktop')
const rendererStagingRoot = path.join(stagingRoot, 'renderer')
const bundledSentryCliPath = path.resolve(__dirname, '..', 'node_modules', '@sentry', 'cli', 'bin', 'sentry-cli')
const sourceMapExtensions = new Set(['.js', '.cjs', '.mjs', '.map'])

const sourceMapsEnabled = (): boolean => process.env.GLITCHTIP_SOURCEMAPS === '1'
const uploadEnabled = (): boolean => process.env.GLITCHTIP_SOURCEMAPS_UPLOAD === '1'

function runSentryCli(args: string[]): void {
    const override = process.env.SENTRY_CLI_PATH?.trim()
    const command = override || process.execPath
    const commandArgs = override ? args : [bundledSentryCliPath, ...args]

    const result = spawnSync(command, commandArgs, {
        env: process.env,
        stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
        throw new Error(`Sentry CLI failed with exit code ${result.status ?? 'unknown'}`)
    }
}

function copySourceMapArtifacts(
    sourceDir: string,
    destinationDir: string,
    include: (relativePath: string) => boolean = () => true,
    relativeRoot = '',
): { files: number; maps: number } {
    let files = 0
    let maps = 0
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
    const mappedSourceFiles = new Set(
        entries
            .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.map')
            .map(entry => entry.name.slice(0, -'.map'.length)),
    )

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name)
        const destinationPath = path.join(destinationDir, entry.name)
        const relativePath = path.join(relativeRoot, entry.name).replace(/\\/gu, '/')

        if (entry.isDirectory()) {
            const copied = copySourceMapArtifacts(sourcePath, destinationPath, include, relativePath)
            files += copied.files
            maps += copied.maps
            continue
        }

        const extension = path.extname(entry.name).toLowerCase()
        if (!entry.isFile() || !sourceMapExtensions.has(extension)) continue
        if (extension !== '.map' && !mappedSourceFiles.has(entry.name)) continue
        if (!include(relativePath)) continue

        fs.mkdirSync(destinationDir, { recursive: true })
        fs.copyFileSync(sourcePath, destinationPath)
        files += 1
        if (extension === '.map') maps += 1
    }

    return { files, maps }
}

function removeSourceMaps(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            removeSourceMaps(entryPath)
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.map') {
            fs.rmSync(entryPath, { force: true })
        }
    }
}

function countSourceMaps(directory: string): number {
    if (!fs.existsSync(directory)) return 0
    let maps = 0
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) maps += countSourceMaps(entryPath)
        else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.map') maps += 1
    }
    return maps
}

async function ensureGlitchTipRelease(release: string): Promise<void> {
    const baseUrl = process.env.SENTRY_URL!.trim().replace(/\/$/u, '')
    const organization = process.env.SENTRY_ORG!.trim()
    const project = process.env.SENTRY_PROJECT!.trim()
    const releaseUrl = `${baseUrl}/api/0/organizations/${encodeURIComponent(organization)}/releases/${encodeURIComponent(release)}/`
    const headers = {
        Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN!.trim()}`,
    }

    const existingRelease = await fetch(releaseUrl, { headers })
    if (existingRelease.ok) return
    if (existingRelease.status !== 404) {
        throw new Error(`Failed to check GlitchTip release: HTTP ${existingRelease.status}`)
    }

    const createRelease = await fetch(`${baseUrl}/api/0/organizations/${encodeURIComponent(organization)}/releases/`, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            version: release,
            projects: [project],
            dateStarted: new Date().toISOString(),
        }),
    })
    if (createRelease.ok) {
        console.log(`Created GlitchTip release ${release}`)
        return
    }

    // Matrix jobs may race while creating the same release. Accept the race only
    // when the release is now visible; surface every other API failure.
    const releaseAfterConflict = await fetch(releaseUrl, { headers })
    if (!releaseAfterConflict.ok) {
        throw new Error(`Failed to create GlitchTip release: HTTP ${createRelease.status}`)
    }
}

export function assertGlitchTipSourceMapConfig(): void {
    if (!uploadEnabled()) return
    if (!sourceMapsEnabled()) {
        throw new Error('GLITCHTIP_SOURCEMAPS_UPLOAD=1 requires GLITCHTIP_SOURCEMAPS=1')
    }

    const requiredVariables = ['SENTRY_URL', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const
    const missingVariables = requiredVariables.filter(name => !process.env[name]?.trim())
    if (missingVariables.length > 0) {
        throw new Error(`Missing GlitchTip source-map configuration: ${missingVariables.join(', ')}`)
    }
}

function prepareSourceMaps(
    sourceDirectory: string,
    targets: Array<{ destinationDirectory: string; include?: (relativePath: string) => boolean; name: string; required?: boolean }>,
): void {
    runSentryCli(['sourcemaps', 'inject', sourceDirectory])

    for (const target of targets) {
        const copied = copySourceMapArtifacts(sourceDirectory, target.destinationDirectory, target.include)
        if (copied.maps === 0) {
            if (target.required) throw new Error(`No ${target.name} source maps found after GlitchTip injection in ${sourceDirectory}`)
            continue
        }
        console.log(`Prepared ${copied.maps} ${target.name} GlitchTip source maps (${copied.files} files)`)
    }

    removeSourceMaps(sourceDirectory)
}

export function prepareGlitchTipSourceMaps(buildPath: string, platform: string, arch: string): void {
    if (!sourceMapsEnabled()) return

    const viteDirectory = path.join(buildPath, '.vite')
    if (!fs.existsSync(viteDirectory)) {
        throw new Error(`Vite output not found for GlitchTip source maps: ${viteDirectory}`)
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
    const dist = process.env.PULSESYNC_BUILD_DIST?.trim() || `${platform}-${arch}`
    const isBundledRendererArtifact = (relativePath: string): boolean => relativePath.startsWith('renderer/main_window/')
    prepareSourceMaps(viteDirectory, [
        {
            destinationDirectory: path.join(desktopStagingRoot, dist),
            include: relativePath => !isBundledRendererArtifact(relativePath),
            name: `desktop ${dist}`,
            required: true,
        },
        {
            destinationDirectory: path.join(rendererStagingRoot, dist),
            include: isBundledRendererArtifact,
            name: `renderer ${dist}`,
        },
    ])
}

export function prepareDesktopCoreGlitchTipSourceMaps(viteOutputDirectory: string, dist: string): void {
    if (!sourceMapsEnabled()) return
    if (!fs.existsSync(viteOutputDirectory)) {
        throw new Error(`Vite output not found for GlitchTip source maps: ${viteOutputDirectory}`)
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
    prepareSourceMaps(viteOutputDirectory, [
        {
            destinationDirectory: path.join(desktopStagingRoot, dist, 'main'),
            name: `desktop core ${dist}`,
            required: true,
        },
    ])
}

export function prepareRemoteRendererGlitchTipSourceMaps(buildOutputDirectory: string): void {
    if (!sourceMapsEnabled()) return
    if (!fs.existsSync(buildOutputDirectory)) {
        throw new Error(`Remote renderer output not found for GlitchTip source maps: ${buildOutputDirectory}`)
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
    prepareSourceMaps(buildOutputDirectory, [
        {
            destinationDirectory: path.join(rendererStagingRoot, 'remote'),
            name: 'remote renderer',
            required: true,
        },
    ])
}

async function uploadStagedSourceMaps(stagedComponentRoot: string, release: string, getUrlPrefix: (dist: string) => string): Promise<number> {
    if (!fs.existsSync(stagedComponentRoot)) return 0
    const distDirectories = fs.readdirSync(stagedComponentRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    const uploadTargets = distDirectories
        .map(entry => ({ dist: entry.name, directory: path.join(stagedComponentRoot, entry.name) }))
        .filter(target => countSourceMaps(target.directory) > 0)
    if (uploadTargets.length === 0) return 0

    await ensureGlitchTipRelease(release)
    for (const target of uploadTargets) {
        runSentryCli([
            'sourcemaps',
            'upload',
            target.directory,
            '--release',
            release,
            '--org',
            process.env.SENTRY_ORG!.trim(),
            '--project',
            process.env.SENTRY_PROJECT!.trim(),
            '--dist',
            target.dist,
            '--url-prefix',
            getUrlPrefix(target.dist),
            '--validate',
        ])
    }

    console.log(`Uploaded GlitchTip source maps for ${release}: ${uploadTargets.map(target => target.dist).join(', ')}`)
    return uploadTargets.length
}

export async function uploadGlitchTipSourceMaps(version: string, commit: string): Promise<void> {
    if (!uploadEnabled()) return
    assertGlitchTipSourceMapConfig()

    const desktopUploads = await uploadStagedSourceMaps(desktopStagingRoot, getDesktopErrorTrackingRelease(version, commit), () => 'app:///.vite')
    if (desktopUploads === 0) throw new Error(`No desktop GlitchTip source maps found in ${desktopStagingRoot}`)

    const rendererBuildNumber = process.env.PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER?.trim()
    const rendererMaps = countSourceMaps(rendererStagingRoot)
    if (rendererMaps > 0 && !rendererBuildNumber) {
        throw new Error('PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER is required for bundled renderer source maps')
    }
    if (rendererBuildNumber) {
        await uploadStagedSourceMaps(rendererStagingRoot, getRendererErrorTrackingRelease(rendererBuildNumber), () => 'app:///.vite')
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
}

export async function uploadRemoteRendererGlitchTipSourceMaps(buildNumber: string, rendererBaseUrl: string): Promise<void> {
    if (!uploadEnabled()) return
    assertGlitchTipSourceMapConfig()

    const uploads = await uploadStagedSourceMaps(rendererStagingRoot, getRendererErrorTrackingRelease(buildNumber), dist => {
        if (dist !== 'remote') throw new Error(`Unexpected remote renderer GlitchTip dist: ${dist}`)
        return rendererBaseUrl.replace(/\/+$/u, '')
    })
    if (uploads === 0) throw new Error(`No remote renderer GlitchTip source maps found in ${rendererStagingRoot}`)

    fs.rmSync(stagingRoot, { force: true, recursive: true })
}
