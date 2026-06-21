import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(__dirname, '..', '.glitchtip-sourcemaps')
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

function copySourceMapArtifacts(sourceDir: string, destinationDir: string): { files: number; maps: number } {
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

        if (entry.isDirectory()) {
            const copied = copySourceMapArtifacts(sourcePath, destinationPath)
            files += copied.files
            maps += copied.maps
            continue
        }

        const extension = path.extname(entry.name).toLowerCase()
        if (!entry.isFile() || !sourceMapExtensions.has(extension)) continue
        if (extension !== '.map' && !mappedSourceFiles.has(entry.name)) continue

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

function findSourceMapDirectories(directory: string): string[] {
    const directories = new Set<string>()

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            for (const child of findSourceMapDirectories(entryPath)) directories.add(child)
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.map') {
            directories.add(directory)
        }
    }

    return [...directories].sort()
}

function getViteUrlPrefix(stagedDirectory: string): string {
    const relativeParts = path.relative(stagingRoot, stagedDirectory).split(path.sep).filter(Boolean)
    if (relativeParts.length < 2) {
        throw new Error(`Unexpected GlitchTip source-map staging directory: ${stagedDirectory}`)
    }

    return `app:///.vite/${relativeParts.slice(1).join('/')}`
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

export function prepareGlitchTipSourceMaps(buildPath: string, platform: string, arch: string): void {
    if (!sourceMapsEnabled()) return

    const viteDirectory = path.join(buildPath, '.vite')
    if (!fs.existsSync(viteDirectory)) {
        throw new Error(`Vite output not found for GlitchTip source maps: ${viteDirectory}`)
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
    runSentryCli(['sourcemaps', 'inject', viteDirectory])

    const destinationDirectory = path.join(stagingRoot, `${platform}-${arch}`)
    const copied = copySourceMapArtifacts(viteDirectory, destinationDirectory)
    if (copied.maps === 0) {
        throw new Error(`No source maps found after GlitchTip injection in ${viteDirectory}`)
    }

    removeSourceMaps(viteDirectory)
    console.log(`Prepared ${copied.maps} GlitchTip source maps (${copied.files} files) for ${platform}-${arch}`)
}

export async function uploadGlitchTipSourceMaps(version: string): Promise<void> {
    if (!uploadEnabled()) return
    assertGlitchTipSourceMapConfig()

    if (!fs.existsSync(stagingRoot)) {
        throw new Error(`GlitchTip source-map staging directory not found: ${stagingRoot}`)
    }

    const release = `pulsesync-client@${version}`
    await ensureGlitchTipRelease(release)

    const sourceMapDirectories = findSourceMapDirectories(stagingRoot)
    if (sourceMapDirectories.length === 0) {
        throw new Error(`No GlitchTip source maps found in ${stagingRoot}`)
    }

    for (const sourceMapDirectory of sourceMapDirectories) {
        runSentryCli([
            'sourcemaps',
            'upload',
            sourceMapDirectory,
            '--release',
            release,
            '--org',
            process.env.SENTRY_ORG!.trim(),
            '--project',
            process.env.SENTRY_PROJECT!.trim(),
            '--url-prefix',
            getViteUrlPrefix(sourceMapDirectory),
            '--validate',
        ])
    }

    fs.rmSync(stagingRoot, { force: true, recursive: true })
    console.log(`Uploaded GlitchTip source maps for ${release}`)
}
