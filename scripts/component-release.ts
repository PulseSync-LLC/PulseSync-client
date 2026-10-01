import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import semver from 'semver'

import { fetchWithRetry } from './network-retry.js'

const platforms: Record<string, [string, string]> = {
    'macos-26': ['desktop-update-hybrid-darwin-universal.json', 'darwin-universal'],
    'ubuntu-latest': ['desktop-update-linux-x64.json', 'linux-x64'],
    'windows-2025': ['desktop-update-win32-x64.json', 'win32-x64'],
}
const components = ['desktopCore', 'artifactWorker', 'pulsesyncNative', 'bootstrapper']

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required`)
    return value
}

function commandOutput(command: string, args: string[]): string {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout || result.error}`)
    return result.stdout.trim()
}

function scriptOutput(script: string, args: string[]): string {
    return commandOutput(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), script, ...args])
}

function ghJson(args: string[]): any {
    return JSON.parse(commandOutput(process.platform === 'win32' ? 'gh.exe' : 'gh', args))
}

function githubReleases(): any[] {
    return ghJson(['api', '--paginate', '--slurp', `repos/${requiredEnv('GITHUB_REPOSITORY')}/releases?per_page=100`]).flat()
}

function checkNewRelease(tag: string): void {
    const version = tag.replace(/^v/u, '')
    const tags = [version, `v${version}`]
    const refs = ghJson(['api', `repos/${requiredEnv('GITHUB_REPOSITORY')}/git/matching-refs/tags/`]) as Array<{ ref: string }>
    if (githubReleases().some(release => tags.includes(release.tag_name)) || refs.some(ref => tags.some(name => ref.ref === `refs/tags/${name}`))) {
        throw new Error(`Release version already exists: ${tag}`)
    }
}

function output(values: Record<string, string>): void {
    fs.appendFileSync(
        requiredEnv('GITHUB_OUTPUT'),
        Object.entries(values)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(''),
    )
}

function resolveRelease(): void {
    const channel = requiredEnv('CHANNEL')
    const component = requiredEnv('COMPONENT')
    const buildOs = requiredEnv('BUILD_OS')
    const mode = requiredEnv('RELEASE_MODE')
    if (!['dev', 'beta'].includes(channel)) throw new Error(`Unsupported channel: ${channel}`)
    if (!components.includes(component)) throw new Error(`Unsupported component: ${component}`)
    if (buildOs !== 'all' && !Object.hasOwn(platforms, buildOs)) throw new Error(`Unsupported platform: ${buildOs}`)
    if (!['new', 'reuse-latest'].includes(mode)) throw new Error(`Unsupported release mode: ${mode}`)
    const matrix = buildOs === 'all' ? ['ubuntu-latest', 'windows-2025', 'macos-26'] : [buildOs]
    let tag: string
    if (mode === 'reuse-latest') {
        if (channel !== 'dev' || component !== 'bootstrapper') throw new Error('reuse-latest supports only the dev bootstrapper')
        const release = githubReleases().find(
            release =>
                release.draft === false &&
                release.prerelease === true &&
                /^v?\d+\.\d+\.\d+-dev\.\d+$/u.test(release.tag_name) &&
                matrix.every(os => release.assets?.some((asset: { name: string }) => asset.name === platforms[os][0])),
        )
        if (!release) throw new Error('No dev release found with manifests for every selected platform')
        tag = release.tag_name
    } else {
        const baseVersion = JSON.parse(fs.readFileSync('packages/desktop-core/package.json', 'utf8')).version.split('-')[0]
        tag =
            process.env.BUILD_VERSION?.trim() ||
            scriptOutput('scripts/resolve-dev-version.ts', [
                '--base-version',
                baseVersion,
                '--branch',
                channel,
                '--channel',
                channel,
                '--repository',
                requiredEnv('GITHUB_REPOSITORY'),
            ])
        const version = semver.parse(tag)
        if (
            !version ||
            version.version !== tag ||
            version.prerelease.length !== 2 ||
            version.prerelease[0] !== channel ||
            typeof version.prerelease[1] !== 'number' ||
            `${version.major}.${version.minor}.${version.patch}` !== baseVersion
        ) {
            throw new Error(`Invalid component release version: ${tag}`)
        }
        checkNewRelease(tag)
    }
    output({ matrix: JSON.stringify(matrix), tag, build_version: tag.replace(/^v/u, ''), prerelease: String(channel !== 'beta') })
    console.log(`Publishing ${component} as ${tag} on ${matrix.join(', ')}`)
}

function filesIn(root: string): string[] {
    return fs
        .readdirSync(root, { recursive: true })
        .map(name => path.join(root, String(name)))
        .filter(file => fs.statSync(file).isFile())
}

function uniqueFile(files: string[], name: string): string {
    const matches = files.filter(file => path.basename(file) === name)
    if (matches.length !== 1) throw new Error(`Missing or duplicate asset: ${name}`)
    return matches[0]
}

async function validateRelease(): Promise<void> {
    const component = requiredEnv('COMPONENT')
    const channel = requiredEnv('CHANNEL')
    const matrix = JSON.parse(requiredEnv('BUILD_MATRIX')) as string[]
    if (!matrix.length || new Set(matrix).size !== matrix.length || matrix.some(os => !Object.hasOwn(platforms, os))) {
        throw new Error('Invalid release platform matrix')
    }
    const expected = matrix.map(os => platforms[os])
    const versions = new Set<string>()
    for (const root of ['component-s3-assets', 'component-release-assets']) {
        const files = filesIn(root)
        const manifests = files.filter(file => /^desktop-update.*\.json$/u.test(path.basename(file)))
        if (manifests.length !== expected.length) throw new Error(`${root}: unexpected platform manifest count`)
        for (const [name, dist] of expected) {
            const manifest = JSON.parse(fs.readFileSync(uniqueFile(manifests, name), 'utf8'))
            if (String(manifest.metadataVersion) !== requiredEnv('METADATA_VERSION') || manifest.channel !== channel) {
                throw new Error(`${name}: incorrect metadataVersion or channel`)
            }
            const target = manifest.targets?.[dist]
            const selected = component === 'bootstrapper' ? target?.bootstrapper : target?.components?.[component]
            if (!selected) throw new Error(`${name}: selected component missing`)
            if (manifest.desktopVersion !== target.components.desktopCore.version) throw new Error(`${name}: desktopVersion mismatch`)
            if (component === 'desktopCore' && manifest.desktopVersion !== requiredEnv('BUILD_VERSION')) {
                throw new Error(`${name}: built desktop core does not match release tag`)
            }
            if (root === 'component-s3-assets') {
                const baseline = JSON.parse(fs.readFileSync(uniqueFile(files, `baseline-${dist}.json`), 'utf8'))
                const baseUrl = (process.env.S3_URL || 'https://s3.pulsesync.dev').replace(/\/+$/u, '')
                const response = await fetchWithRetry(
                    `${baseUrl}/builds/app/${channel}/${name}?_=${Date.now()}`,
                    { cache: 'no-store' },
                    { label: 'S3 publication baseline' },
                )
                if (!response.ok) throw new Error(`Cannot verify current S3 baseline (${response.status}): ${name}`)
                const current = await response.json()
                if (JSON.stringify(current) !== JSON.stringify(baseline))
                    throw new Error(`S3 baseline changed during build: ${name}; rebuild before publishing`)
            }
            versions.add(selected.version)
            const assetName = decodeURIComponent(new URL(selected.artifact.url).pathname.split('/').pop() || '')
            const data = fs.readFileSync(uniqueFile(files, assetName))
            if (crypto.createHash('sha256').update(data).digest('hex') !== selected.artifact.sha256 || data.length !== selected.artifact.size) {
                throw new Error(`${root}: selected artifact integrity mismatch: ${assetName}`)
            }
        }
    }
    if (versions.size !== 1) throw new Error(`Component versions differ: ${[...versions].join(', ')}`)
    fs.mkdirSync('component-s3-publish')
    for (const file of filesIn('component-s3-assets').filter(file => !path.basename(file).startsWith('baseline-'))) {
        const destination = path.join('component-s3-publish', path.basename(file))
        if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(fs.readFileSync(file)))
            throw new Error(`S3 asset collision: ${destination}`)
        fs.copyFileSync(file, destination)
    }
    output({ version: [...versions][0] })
    console.log(`Validated ${component} release for ${matrix.join(', ')}`)
}

function rebaseRelease(): void {
    const component = requiredEnv('COMPONENT')
    const files = filesIn('component-release-assets')
    const manifests = files.filter(file => /^desktop-update.*\.json$/u.test(path.basename(file)))
    if (!manifests.length) throw new Error('No prepared component manifests found')
    for (const manifestFile of manifests) {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
        const dist = Object.keys(manifest.targets)[0]
        const target = manifest.targets[dist]
        const selected = component === 'bootstrapper' ? target.bootstrapper : target.components[component]
        const assetName = decodeURIComponent(new URL(selected.artifact.url).pathname.split('/').pop() || '')
        console.log(
            scriptOutput('scripts/github-release-runtime.ts', [
                'prepare-component',
                '--source-manifest',
                manifestFile,
                '--source-asset',
                uniqueFile(files, assetName),
                '--target',
                `rebased-component-release/${dist}`,
                '--previous-github-manifest',
                `current-release-manifests/${path.basename(manifestFile)}`,
                '--repository',
                requiredEnv('GITHUB_REPOSITORY'),
                '--tag',
                requiredEnv('TAG'),
                '--channel',
                requiredEnv('CHANNEL'),
                '--dist',
                dist,
                '--component',
                component,
            ]),
        )
    }
    fs.rmSync('component-release-assets', { recursive: true })
    fs.renameSync('rebased-component-release', 'component-release-assets')
}

async function main(): Promise<void> {
    const command = process.argv[2]
    if (command === 'resolve') resolveRelease()
    else if (command === 'validate') await validateRelease()
    else if (command === 'rebase') rebaseRelease()
    else if (command === 'check-new') checkNewRelease(requiredEnv('TAG'))
    else throw new Error('Usage: tsx scripts/component-release.ts <resolve|validate|rebase|check-new>')
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
