import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import semver from 'semver'

import { collectSourceOwnership } from './classify-common-changes.mjs'
import { classifyDependencyChanges, readDependencySnapshot } from './classify-dependency-changes.mjs'

const hostInputs = [
    /^src\/main\/(?!core\/)/u,
    /^src\/preload\/(?!mainWindowPreload\.ts$)/u,
    /^src\/renderer\/preloader\.(?:html|ts)$/u,
    /^src\/styles\/(?:preloader|globals|fonts)\.css$/u,
    /^src\/renderer\/shared\/assets\/fonts\//u,
    /^src\/locales\/bundled\//u,
    /^(?:icons|static\/assets\/icon)\//u,
    /^(?:forge\.config\.ts|vite\.(?:main|preload|renderer|worker)\.config\.ts|electron-builder\.yml|Info\.plist|tsconfig[^/]*\.json)$/u,
    /^scripts\/(?:build|component-layout|code-signing|glitchtip-sourcemaps)\.ts$/u,
    /^scripts\/windows-sign\./u,
]
const bootstrapperInputs = [
    /^packages\/bootstrapper\/(?!(?:tests|benches|target|\.idea)\/)(?!.*\.(?:md|txt)$)/u,
    /^scripts\/bootstrapper\/build\.ts$/u,
    /^icons\/icon\.ico$/u, // Embedded by packages/bootstrapper/build.rs.
    /^(?:\.cargo\/|rust-toolchain(?:\.toml)?$)/u,
    /^scripts\/(?:code-signing\.ts|windows-sign\.)/u,
]

function git(root, args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

function readSnapshot(root, ref) {
    const files = new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean))
    const cache = new Map()
    const read = file => {
        if (!files.has(file)) throw new Error(`Missing ${file} at ${ref}`)
        if (!cache.has(file)) cache.set(file, git(root, ['show', `${ref}:${file}`]))
        return cache.get(file)
    }
    return { read, exists: file => files.has(file) }
}

function bootstrapperVersion(text) {
    const section = text.split(/^\[package\][ \t]*\r?$/mu)[1]?.split(/^\[/mu)[0]
    const version = /^version\s*=\s*"([^"]+)"/mu.exec(section ?? '')?.[1]
    if (!version) throw new Error('Missing [package].version in packages/bootstrapper/Cargo.toml')
    return version
}

export function checkRuntimeVersions({ changedFiles, before, after, hostSources = new Set(), dependencies }) {
    const hostChanges = changedFiles.filter(file => hostInputs.some(pattern => pattern.test(file)) || hostSources.has(file))
    if (dependencies?.desktop) hostChanges.push(...dependencies.details)
    const bootstrapperChanges = changedFiles.filter(file => bootstrapperInputs.some(pattern => pattern.test(file)))
    const errors = []
    for (const [name, manifest, oldVersion, newVersion, changes] of [
        ['Host', 'package.json', before.host, after.host, hostChanges],
        ['Bootstrapper', 'packages/bootstrapper/Cargo.toml', before.bootstrapper, after.bootstrapper, bootstrapperChanges],
    ]) {
        if (!semver.valid(oldVersion) || !semver.valid(newVersion)) {
            errors.push(`${name}: invalid version (${oldVersion} -> ${newVersion}) in ${manifest}`)
        } else if (semver.lt(newVersion, oldVersion) || (changes.length && !semver.gt(newVersion, oldVersion))) {
            errors.push(
                `${name}: increase version in ${manifest} above ${oldVersion} (got ${newVersion}). Inputs: ${changes.join(', ') || 'version downgrade'}`,
            )
        }
    }
    return { errors, hostChanges, bootstrapperChanges }
}

export function verifyRuntimeVersions(base, head, root = process.cwd()) {
    for (const ref of [base, head]) {
        if (!/^[a-f0-9]{40}$/iu.test(ref ?? '') || /^0+$/u.test(ref)) throw new Error('BASE_SHA and HEAD_SHA must be full commit SHAs')
    }
    const mergeBase = git(root, ['merge-base', base, head]).trim()
    // --no-renames retains both the removed and added path, including moves out of host scope.
    const changedFiles = git(root, ['diff', '--name-only', '--no-renames', '-z', mergeBase, head, '--']).split('\0').filter(Boolean)
    const previous = readSnapshot(root, base)
    const branchBase = mergeBase === base ? previous : readSnapshot(root, mergeBase)
    const current = readSnapshot(root, head)
    const oldPackage = JSON.parse(previous.read('package.json'))
    const newPackage = JSON.parse(current.read('package.json'))
    const hostSources = new Set()
    if (changedFiles.some(file => file.startsWith('src/') && !hostInputs.some(pattern => pattern.test(file)))) {
        // Check both sides so deleting an import or renaming a dependency cannot hide host ownership.
        for (const ref of new Set([base, mergeBase, head])) {
            const snapshot = readSnapshot(root, ref)
            const { closures } = collectSourceOwnership(root, snapshot)
            for (const file of closures.desktop) hostSources.add(file)
        }
    }
    let dependencies
    if (changedFiles.some(file => ['package.json', 'yarn.lock'].includes(file))) {
        const oldSnapshot = readDependencySnapshot(mergeBase, root)
        const newSnapshot = readDependencySnapshot(head, root, oldSnapshot.peerConsumers)
        // Version and CI command changes do not themselves change dependency ownership.
        for (const snapshot of [oldSnapshot, newSnapshot]) {
            snapshot.packageJson = { ...snapshot.packageJson }
            for (const key of ['version', 'buildInfo', 'scripts']) delete snapshot.packageJson[key]
        }
        dependencies = classifyDependencyChanges(oldSnapshot, newSnapshot)
    }
    const oldBootstrapper = bootstrapperVersion(previous.read('packages/bootstrapper/Cargo.toml'))
    const newBootstrapper = bootstrapperVersion(current.read('packages/bootstrapper/Cargo.toml'))
    // An untouched version inherits the target branch's bump when Git merges the PR.
    const after = {
        host: newPackage.version === JSON.parse(branchBase.read('package.json')).version ? oldPackage.version : newPackage.version,
        bootstrapper:
            newBootstrapper === bootstrapperVersion(branchBase.read('packages/bootstrapper/Cargo.toml')) ? oldBootstrapper : newBootstrapper,
    }
    return checkRuntimeVersions({
        changedFiles,
        before: { host: oldPackage.version, bootstrapper: oldBootstrapper },
        after,
        hostSources,
        dependencies,
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const result = verifyRuntimeVersions(process.env.BASE_SHA, process.env.HEAD_SHA)
        if (result.errors.length) throw new Error(result.errors.join('\n'))
        console.log(`Runtime versions OK (host inputs: ${result.hostChanges.length}, bootstrapper inputs: ${result.bootstrapperChanges.length})`)
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
