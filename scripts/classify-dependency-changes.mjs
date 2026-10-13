import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { collectSourceOwnership } from './classify-common-changes.mjs'

const sections = ['dependencies', 'devDependencies', 'optionalDependencies']
const full = reason => ({ desktop: true, renderer: true, details: [reason] })
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        )
    return value
}
const stable = value => JSON.stringify(canonical(value))
const packageName = selector => {
    const separator = selector.indexOf('@', selector.startsWith('@') ? 1 : 0)
    if (separator <= 0) throw new Error(`Unsupported lock selector: ${selector}`)
    return selector.slice(0, separator)
}
const scalar = value => (value.startsWith('"') ? JSON.parse(value) : value)

// Yarn classic's generated format only. Unrecognized syntax must never produce renderer-only routing.
export function parseYarnLock(text) {
    if (!text.includes('# yarn lockfile v1')) throw new Error('Unsupported lockfile format')
    const entries = new Map()
    let entry
    let group
    for (const line of text.split(/\r?\n/u)) {
        if (!line.trim() || line.startsWith('#')) continue
        if (!line.startsWith(' ')) {
            if (!line.endsWith(':')) throw new Error('Unsupported lock entry')
            const header = line.slice(0, -1)
            const selectors = []
            const token = /(?:"(?:[^"\\]|\\.)*"|[^\s,]+)(?:, |$)/gy
            let offset = 0
            while (offset < header.length) {
                token.lastIndex = offset
                const match = token.exec(header)
                if (!match) throw new Error(`Unsupported lock selector list: ${header}`)
                selectors.push(scalar(match[0].replace(/, $/u, '')))
                offset = token.lastIndex
            }
            entry = { name: packageName(selectors[0]), dependencies: {}, optionalDependencies: {} }
            group = null
            for (const selector of selectors) {
                if (packageName(selector) !== entry.name || entries.has(selector)) throw new Error(`Duplicate/mixed lock selector: ${selector}`)
                entries.set(selector, entry)
            }
            continue
        }
        if (!entry) throw new Error('Lock field without an entry')
        const field = /^  (version|resolved|integrity) (.+)$/u.exec(line)
        if (field) {
            if (Object.hasOwn(entry, field[1])) throw new Error('Duplicate lock field')
            entry[field[1]] = scalar(field[2])
            group = null
            continue
        }
        const section = /^  (dependencies|optionalDependencies):$/u.exec(line)
        if (section) {
            group = section[1]
            continue
        }
        const dependency = /^    ("(?:[^"\\]|\\.)*"|[^\s]+) (.+)$/u.exec(line)
        if (!group || !dependency) throw new Error(`Unsupported lock field: ${line.trim()}`)
        const name = scalar(dependency[1])
        if (Object.hasOwn(entry[group], name)) throw new Error('Duplicate lock dependency')
        entry[group][name] = scalar(dependency[2])
    }
    for (const entry of entries.values()) if (!entry.version) throw new Error(`Lock version missing: ${entry.name}`)
    return entries
}

function graph(snapshot) {
    const lock = parseYarnLock(snapshot.lockText)
    const owners = new Map()
    const selectorsByName = new Map()
    for (const [selector, entry] of lock) {
        if (!selectorsByName.has(entry.name)) selectorsByName.set(entry.name, [])
        selectorsByName.get(entry.name).push(selector)
    }
    const expandedDesktopNames = new Set()
    const visited = new Set()
    function collect(name, range, owner, optional = false) {
        const selector = `${name}@${range}`
        const entry = lock.get(selector)
        if (!entry) throw new Error(`Unresolved lock dependency: ${selector}`)
        const peerKey = Object.hasOwn(snapshot.peerConsumers ?? {}, name) ? name : `${name}@${entry.version}`
        // These audited platform binary leaves, including macOS-only fsevents,
        // have no peer dependencies. They can be absent on other runner platforms;
        // unknown missing metadata remains ambiguous.
        const platformBinary =
            optional &&
            /^(?:fsevents$|@esbuild\/|@(?:oxc-parser|oxfmt|oxlint|rolldown)\/binding-|@parcel\/watcher-|@sentry\/cli-|@typescript\/typescript-|lightningcss-)/u.test(
                name,
            ) &&
            !Object.keys(entry.dependencies).length &&
            !Object.keys(entry.optionalDependencies).length
        if (owner === 'desktop' && snapshot.requirePeerMetadata && !Object.hasOwn(snapshot.peerConsumers ?? {}, peerKey) && !platformBinary) {
            throw new Error(`Missing host/build peer metadata: ${peerKey}`)
        }
        const key = `${owner}:${selector}`
        if (visited.has(key)) return
        visited.add(key)
        if (!owners.has(name)) owners.set(name, new Set())
        owners.get(name).add(owner)
        // Normal dependencies can be hoisted too, not just peer providers.
        // Once a package is shared with desktop, all its locked variants and
        // their descendants must retain desktop ownership.
        if (owner === 'desktop' && !expandedDesktopNames.has(name)) {
            expandedDesktopNames.add(name)
            for (const variant of selectorsByName.get(name)) collect(name, variant.slice(name.length + 1), owner, optional)
        }
        for (const peer of snapshot.peerConsumers?.[peerKey] ?? []) {
            if (!owners.has(peer)) owners.set(peer, new Set())
            owners.get(peer).add(owner)
            // Peer providers and their dependencies can be hoisted. Include all
            // locked versions by name instead of guessing a single resolution.
            for (const peerSelector of selectorsByName.get(peer) ?? []) collect(peer, peerSelector.slice(peer.length + 1), owner)
        }
        for (const [child, version] of Object.entries(entry.dependencies)) collect(child, version, owner)
        for (const [child, version] of Object.entries(entry.optionalDependencies)) collect(child, version, owner, true)
    }
    const unresolved = []
    for (const section of sections) {
        for (const [name, range] of Object.entries(snapshot.packageJson[section] ?? {})) {
            const sourceOwners = snapshot.packageOwners?.[name] ?? []
            if (section !== 'dependencies') collect(name, range, 'desktop', section === 'optionalDependencies')
            else if (sourceOwners.length) {
                for (const owner of sourceOwners) collect(name, range, owner === 'renderer' ? 'renderer' : 'desktop')
            } else unresolved.push([name, range])
        }
    }
    // Peer-only roots (for example react-is/rxjs) inherit the consumers reached
    // above. A root with no source or dependency consumer is an unknown owner.
    for (const [name, range] of unresolved) {
        for (const owner of owners.get(name) ?? ['desktop']) collect(name, range, owner)
    }
    return { lock, owners }
}

// Snapshots contain packageJson, lockText and packageOwners from source imports.
// peerConsumers maps package names (or exact name@version fixtures) to peer names.
export function classifyDependencyChanges(before, after) {
    try {
        const metadata = pkg => Object.fromEntries(Object.entries(pkg).filter(([key]) => !sections.includes(key)))
        if (stable(metadata(before.packageJson)) !== stable(metadata(after.packageJson))) return full('Non-dependency package metadata changed')
        const changedRoots = new Set()
        for (const section of sections) {
            const old = before.packageJson[section] ?? {}
            const current = after.packageJson[section] ?? {}
            for (const name of new Set([...Object.keys(old), ...Object.keys(current)])) {
                if (old[name] === current[name]) continue
                if (section !== 'dependencies') return full(`Host/build/unknown dependency changed: ${name}`)
                changedRoots.add(name)
            }
        }
        const old = graph(before)
        const current = graph(after)
        const changed = new Set(changedRoots)
        for (const selector of new Set([...old.lock.keys(), ...current.lock.keys()])) {
            if (stable(old.lock.get(selector) ?? null) !== stable(current.lock.get(selector) ?? null)) changed.add(packageName(selector))
        }
        for (const name of changed) {
            const owners = new Set([...(old.owners.get(name) ?? []), ...(current.owners.get(name) ?? [])])
            if (!owners.has('renderer') || owners.has('desktop')) return full(`Shared/host/unknown dependency changed: ${name}`)
        }
        return { desktop: false, renderer: changed.size > 0, details: [`Renderer dependency changes: ${[...changed].sort().join(', ') || 'none'}`] }
    } catch (error) {
        return full(error.message)
    }
}

function git(root, args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

// Read manifests without loading any installed package code. Peer edges are absent from Yarn v1.
// Yarn can hoist/dedupe compatible lock versions. Union all installed versions
// by package name rather than assuming every lock version has its own directory.
function installedPeers(root) {
    const peers = {}
    const visited = new Set()
    function scan(directory) {
        if (!fs.existsSync(directory)) return
        const real = fs.realpathSync(directory)
        if (visited.has(real)) return
        visited.add(real)
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
            if (item.name.startsWith('.')) continue
            const target = path.join(directory, item.name)
            if (item.name.startsWith('@')) {
                scan(target)
                continue
            }
            const manifest = path.join(target, 'package.json')
            if (!fs.existsSync(manifest)) continue
            const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
            peers[pkg.name] = [...new Set([...(peers[pkg.name] ?? []), ...Object.keys(pkg.peerDependencies ?? {})])]
            scan(path.join(target, 'node_modules'))
        }
    }
    scan(path.join(root, 'node_modules'))
    return peers
}

export function readDependencySnapshot(ref, root = process.cwd(), peerConsumers = installedPeers(root)) {
    const files = new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean))
    const contents = new Map()
    const read = file => {
        if (!files.has(file)) throw new Error(`Missing snapshot source: ${file}`)
        if (!contents.has(file)) contents.set(file, git(root, ['show', `${ref}:${file}`]))
        return contents.get(file)
    }
    const packageJson = JSON.parse(read('package.json'))
    const lockText = read('yarn.lock')
    const { packageOwners } = collectSourceOwnership(root, { read, exists: file => files.has(file), includeBuildConfigs: true })
    return {
        packageJson,
        lockText,
        packageOwners: Object.fromEntries([...packageOwners].map(([name, owners]) => [name, [...owners]])),
        peerConsumers,
        requirePeerMetadata: true,
    }
}

export function classifyDependencyPush(before, root = process.cwd(), after = 'HEAD') {
    try {
        if (!/^[a-f0-9]{40}$/iu.test(before ?? '') || /^0+$/u.test(before)) throw new Error('Missing previous commit for dependency changes')
        const peers = installedPeers(root)
        const previous = readDependencySnapshot(before, root, peers)
        const current = readDependencySnapshot(after, root, peers)
        return classifyDependencyChanges(previous, current)
    } catch (error) {
        return full(error.message)
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const result = classifyDependencyPush(process.env.BEFORE_SHA)
    for (const detail of result.details) console.log(detail)
    for (const name of ['desktop', 'renderer']) {
        console.log(`${name}=${result[name]}`)
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`)
    }
}
