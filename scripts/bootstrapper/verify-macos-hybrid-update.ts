import crypto from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function run(program: string, args: string[]): string {
    const result = spawnSync(program, args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? 'signal'}): ${result.stderr || result.stdout}`)
    return result.stdout.trim()
}

async function waitFor<T>(read: () => T | null, label: string, timeoutMs = 15_000): Promise<T> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
        const value = read()
        if (value !== null) return value
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for ${label}`)
}

function sha256File(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function sha256Directory(directory: string): string {
    const files: string[] = []
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name)
            if (entry.isDirectory()) visit(entryPath)
            else if (entry.isFile()) files.push(path.relative(directory, entryPath))
        }
    }
    visit(directory)
    files.sort()
    const hash = crypto.createHash('sha256')
    for (const relative of files) {
        hash.update(relative.replace(/\\/gu, '/'))
        hash.update('\0')
        hash.update(fs.readFileSync(path.join(directory, relative)))
        hash.update('\0')
    }
    return hash.digest('hex')
}

function plist(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PulseSync</string>
<key>CFBundleIdentifier</key><string>app.pulsesync.hybrid-fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
`
}

function writeCore(directory: string, version: string): void {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'index.cjs'), `module.exports = ${JSON.stringify(version)}\n`)
    fs.writeFileSync(path.join(directory, 'mainWindowPreload.cjs'), `module.exports = ${JSON.stringify(`preload-${version}`)}\n`)
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name: 'pulsesync_desktop_core', version }, null, 4)}\n`)
}

function createBundle(root: string, stateRoot: string, fixtureExecutable: string, bootstrapper: string): string {
    const bundle = path.join(root, 'PulseSync.app')
    const contents = path.join(bundle, 'Contents')
    const executable = path.join(contents, 'MacOS', 'PulseSync')
    const resources = path.join(contents, 'Resources')
    const bootstrapperTarget = path.join(resources, 'bootstrapper', 'pulsesync-bootstrapper')
    const core = path.join(contents, 'modules', 'pulsesync_desktop_core-1', 'pulsesync_desktop_core')
    const worker = path.join(contents, 'modules', 'pulsesync_artifact_worker-1', 'pulsesync_artifact_worker')
    const native = path.join(contents, 'modules', 'pulsesync_native-1', 'pulsesync_native')
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.mkdirSync(path.dirname(bootstrapperTarget), { recursive: true })
    fs.copyFileSync(fixtureExecutable, executable)
    fs.copyFileSync(bootstrapper, bootstrapperTarget)
    fs.chmodSync(executable, 0o755)
    fs.chmodSync(bootstrapperTarget, 0o755)
    fs.writeFileSync(path.join(contents, 'Info.plist'), plist())
    writeCore(core, '1.0.0')
    fs.mkdirSync(worker, { recursive: true })
    fs.writeFileSync(path.join(worker, 'index.cjs'), 'module.exports = "worker"\n')
    fs.mkdirSync(native, { recursive: true })
    fs.writeFileSync(path.join(native, 'binding.node'), 'native-fixture')
    fs.writeFileSync(path.join(resources, 'fixture-state-root.txt'), `${stateRoot}\n`)
    fs.writeFileSync(path.join(resources, 'fixture-version.txt'), '1.0.0\n')
    fs.writeFileSync(path.join(resources, 'fixture-claim-delay-ms.txt'), '0\n')
    const components = {
        desktopCore: {
            version: '1.0.0',
            revision: 1,
            diskName: 'pulsesync_desktop_core',
            path: 'modules/pulsesync_desktop_core-1/pulsesync_desktop_core',
            sha256: sha256Directory(core),
            required: true,
        },
        artifactWorker: {
            version: '1.0.0',
            revision: 1,
            diskName: 'pulsesync_artifact_worker',
            path: 'modules/pulsesync_artifact_worker-1/pulsesync_artifact_worker',
            sha256: sha256Directory(worker),
            required: true,
        },
        pulsesyncNative: {
            version: '1.0.0',
            revision: 1,
            diskName: 'pulsesync_native',
            path: 'modules/pulsesync_native-1/pulsesync_native',
            sha256: sha256Directory(native),
            required: true,
            electronAbi: '140',
        },
        bootstrapper: {
            version: '0.3.5',
            path: 'Resources/bootstrapper/pulsesync-bootstrapper',
            sha256: sha256File(bootstrapperTarget),
            required: true,
        },
    }
    fs.writeFileSync(
        path.join(resources, 'pulsesync-runtime.json'),
        `${JSON.stringify(
            {
                schemaVersion: 3,
                hostVersion: '1.0.0',
                desktopVersion: '1.0.0',
                bundleVersion: '1',
                metadataVersion: 1,
                hostElectronAbi: '140',
                components,
            },
            null,
            4,
        )}\n`,
    )
    return bundle
}

type Lease = { leaseId: string; pid: number }
type Runtime = {
    activationState: 'confirmed' | 'pending'
    components: Record<string, { path: string }>
    corePath: string
    coreVersion: string
    generation: number
    hostPath: string
}

function readLease(stateRoot: string): Lease | null {
    const leasePath = path.join(stateRoot, 'runtime', 'active-app.json')
    if (!fs.existsSync(leasePath)) return null
    return JSON.parse(fs.readFileSync(leasePath, 'utf8')) as Lease
}

function resolveRuntime(bootstrapper: string, stateRoot: string, hostBundle: string, lease: Lease): Runtime {
    return JSON.parse(
        run(bootstrapper, [
            'resolve-runtime',
            '--json',
            '--state-root',
            stateRoot,
            '--host-bundle',
            hostBundle,
            '--active-lease-id',
            lease.leaseId,
        ]),
    ) as Runtime
}

function acknowledgeRuntime(bootstrapper: string, stateRoot: string, hostBundle: string, lease: Lease, generation: number): void {
    run(bootstrapper, [
        'acknowledge-runtime',
        '--json',
        '--state-root',
        stateRoot,
        '--host-bundle',
        hostBundle,
        '--active-lease-id',
        lease.leaseId,
        '--generation',
        String(generation),
    ])
}

function writeHybridManifest(root: string, dist: string, hostBundle: string, version: string, revision: number, metadataVersion: number): string {
    const diskName = 'pulsesync_desktop_core'
    const core = path.join(root, `core-${revision}`, diskName)
    writeCore(core, version)
    const archive = path.join(root, `pulsesync-component-desktopCore-${version}-${dist}.zip`)
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', core, archive])
    const files = fs
        .readdirSync(core)
        .sort()
        .map(name => {
            const filePath = path.join(core, name)
            return {
                path: name,
                sha256: sha256File(filePath),
                size: fs.statSync(filePath).size,
                executable: false,
                artifact: { url: filePath, sha256: sha256File(filePath), size: fs.statSync(filePath).size },
                patches: [],
            }
        })
    const hostArtifact = path.join(hostBundle, 'Contents', 'Info.plist')
    const manifestPath = path.join(root, `manifest-${metadataVersion}.json`)
    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
            {
                schemaVersion: 4,
                metadataVersion,
                channel: 'dev',
                desktopVersion: version,
                desktopApi: '1.0.0',
                targets: {
                    [dist]: {
                        layout: 'macos-hybrid',
                        host: {
                            version: '1.0.0',
                            bundleVersion: '1',
                            electronAbi: '140',
                            required: true,
                            artifact: {
                                url: hostArtifact,
                                sha256: sha256File(hostArtifact),
                                size: fs.statSync(hostArtifact).size,
                            },
                        },
                        components: {
                            desktopCore: {
                                version,
                                revision,
                                diskName,
                                required: true,
                                contentSha256: sha256Directory(core),
                                files,
                                requiresHost: '>=1.0.0 <2.0.0',
                                artifact: { url: archive, sha256: sha256File(archive), size: fs.statSync(archive).size },
                            },
                        },
                    },
                },
            },
            null,
            4,
        )}\n`,
    )
    return manifestPath
}

function prepareUpdate(
    bootstrapper: string,
    stateRoot: string,
    hostBundle: string,
    appExecutable: string,
    lease: Lease,
    manifest: string,
    installedVersion: string,
    dist: string,
): string {
    const result = JSON.parse(
        run(bootstrapper, [
            'prepare-update',
            '--json',
            '--state-root',
            stateRoot,
            '--host-bundle',
            hostBundle,
            '--app-executable',
            appExecutable,
            '--app-executable-name',
            'Contents/MacOS/PulseSync',
            '--installed-version',
            installedVersion,
            '--dist',
            dist,
            '--channel',
            'dev',
            '--requested-source',
            'direct',
            '--manifest-url',
            manifest,
            '--retain-app-versions',
            '2',
            '--active-lease-id',
            lease.leaseId,
        ]),
    ) as { state: string; transaction?: { file: string } }
    if (result.state !== 'prepared' || !result.transaction?.file) {
        throw new Error(`Hybrid update did not prepare: ${JSON.stringify(result)}`)
    }
    return result.transaction.file
}

async function handoff(
    bootstrapper: string,
    stateRoot: string,
    hostBundle: string,
    appExecutable: string,
    oldLease: Lease,
): Promise<Lease> {
    const child = spawn(
        bootstrapper,
        [
            'start',
            '--json',
            '--progress-json',
            '--state-root',
            stateRoot,
            '--host-bundle',
            hostBundle,
            '--app-executable',
            appExecutable,
            '--app-executable-name',
            'Contents/MacOS/PulseSync',
            '--wait-for-pid',
            String(oldLease.pid),
            '--active-lease-id',
            oldLease.leaseId,
            '--wait-timeout-ms',
            '10000',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
        stderr += String(chunk)
        if (stderr.includes('"event":"handoff-armed"')) {
            try {
                process.kill(oldLease.pid, 'SIGTERM')
            } catch {}
        }
    })
    const stdout = await new Promise<string>((resolve, reject) => {
        let value = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => (value += String(chunk)))
        child.once('error', reject)
        child.once('close', code => (code === 0 ? resolve(value) : reject(new Error(`start failed (${code}): ${stderr}\n${value}`))))
    })
    const result = JSON.parse(stdout) as { state: string }
    if (result.state !== 'launched') throw new Error(`Hybrid handoff did not launch: ${stdout}`)
    return await waitFor(() => {
        const lease = readLease(stateRoot)
        return lease && lease.pid !== oldLease.pid ? lease : null
    }, 'hybrid successor lease')
}

async function macosHostHandoff(
    bootstrapper: string,
    stateRoot: string,
    hostBundle: string,
    appExecutable: string,
    oldLease: Lease,
): Promise<{ lease: Lease; transactionFile: string }> {
    const child = spawn(
        bootstrapper,
        [
            'start',
            '--json',
            '--progress-json',
            '--state-root',
            stateRoot,
            '--host-bundle',
            hostBundle,
            '--app-executable',
            appExecutable,
            '--app-executable-name',
            'Contents/MacOS/PulseSync',
            '--wait-for-pid',
            String(oldLease.pid),
            '--active-lease-id',
            oldLease.leaseId,
            '--wait-timeout-ms',
            '10000',
        ],
        { env: { ...process.env, PULSESYNC_DISABLE_LAUNCH_AGENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
        stderr += String(chunk)
        if (stderr.includes('"event":"handoff-armed"')) {
            try {
                process.kill(oldLease.pid, 'SIGTERM')
            } catch {}
        }
    })
    const stdout = await new Promise<string>((resolve, reject) => {
        let value = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => (value += String(chunk)))
        child.once('error', reject)
        child.once('close', code => (code === 0 ? resolve(value) : reject(new Error(`macOS start failed (${code}): ${stderr}\n${value}`))))
    })
    const result = JSON.parse(stdout) as { state: string; selectedTransactionFile?: string }
    if (result.state !== 'reserved' || !result.selectedTransactionFile) {
        throw new Error(`macOS hybrid handoff was not reserved: ${stdout}`)
    }
    const lease = await waitFor(() => {
        const candidate = readLease(stateRoot)
        return candidate && candidate.pid !== oldLease.pid ? candidate : null
    }, 'hybrid host successor lease', 25_000)
    return { lease, transactionFile: result.selectedTransactionFile }
}

function createIncomingHostBundle(
    root: string,
    hostBundle: string,
    dist: string,
    manifestPath: string,
    hostVersion: string,
    bundleVersion: number,
    coreVersion: string,
    revision: number,
    metadataVersion: number,
): { archive: string; bundle: string } {
    const incomingRoot = path.join(root, `incoming-host-${bundleVersion}`)
    fs.mkdirSync(incomingRoot, { recursive: true })
    const incomingBundle = path.join(incomingRoot, 'PulseSync.app')
    run('/usr/bin/ditto', [hostBundle, incomingBundle])
    run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${hostVersion}`, path.join(incomingBundle, 'Contents', 'Info.plist')])
    run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${bundleVersion}`, path.join(incomingBundle, 'Contents', 'Info.plist')])
    const descriptorPath = path.join(incomingBundle, 'Contents', 'Resources', 'pulsesync-runtime.json')
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as {
        bundleVersion: string
        metadataVersion?: number
        desktopVersion: string
        hostVersion: string
        components: Record<string, { version: string; revision?: number; diskName?: string; path: string; sha256: string; required: boolean }>
    }
    const oldCorePath = path.join(incomingBundle, 'Contents', descriptor.components.desktopCore.path)
    fs.rmSync(path.dirname(oldCorePath), { recursive: true, force: true })
    const newCorePath = path.join(incomingBundle, 'Contents', 'modules', `pulsesync_desktop_core-${revision}`, 'pulsesync_desktop_core')
    writeCore(newCorePath, coreVersion)
    descriptor.bundleVersion = String(bundleVersion)
    descriptor.metadataVersion = metadataVersion
    descriptor.desktopVersion = coreVersion
    descriptor.hostVersion = hostVersion
    descriptor.components.desktopCore = {
        version: coreVersion,
        revision,
        diskName: 'pulsesync_desktop_core',
        path: `modules/pulsesync_desktop_core-${revision}/pulsesync_desktop_core`,
        sha256: sha256Directory(newCorePath),
        required: true,
    }
    fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 4)}\n`)
    const archive = path.join(root, `pulsesync-host-bundle-${bundleVersion}-${dist}.zip`)
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', incomingBundle, archive])
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        targets: Record<string, { host: { version: string; bundleVersion: string; artifact: { url: string; sha256: string; size: number } } }>
    }
    manifest.targets[dist].host = {
        version: hostVersion,
        bundleVersion: String(bundleVersion),
        artifact: { url: archive, sha256: sha256File(archive), size: fs.statSync(archive).size },
    }
    ;(manifest.targets[dist].host as { electronAbi?: string; required?: boolean }).electronAbi = '140'
    ;(manifest.targets[dist].host as { electronAbi?: string; required?: boolean }).required = true
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`)
    return { archive, bundle: incomingBundle }
}

function terminate(childOrPid: ChildProcess | number | null): void {
    const pid = typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid
    if (!pid) return
    try {
        process.kill(pid, 'SIGTERM')
    } catch {}
}

async function main(): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('verify-macos-hybrid-update is only supported on macOS')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-macos-hybrid-'))
    const stateRoot = path.join(root, 'state')
    const bootstrapper = path.join(projectRoot, 'packages', 'bootstrapper', 'target', 'debug', 'pulsesync-bootstrapper')
    const fixtureSource = path.join(projectRoot, 'scripts', 'bootstrapper', 'fixtures', 'macos-host.rs')
    const fixtureExecutable = path.join(root, 'fixture-host')
    const dist = `darwin-${process.arch}`
    let processHandle: ChildProcess | null = null
    let livePid: number | null = null
    try {
        run('rustc', ['--edition', '2024', fixtureSource, '-o', fixtureExecutable])
        const hostBundle = createBundle(path.join(root, 'Applications'), stateRoot, fixtureExecutable, bootstrapper)
        const appExecutable = path.join(hostBundle, 'Contents', 'MacOS', 'PulseSync')
        processHandle = spawn(appExecutable, [], { stdio: 'ignore' })
        const seedLease = await waitFor(() => readLease(stateRoot), 'seed lease')
        livePid = seedLease.pid
        const seeded = resolveRuntime(bootstrapper, stateRoot, hostBundle, seedLease)
        const canonicalStateRoot = fs.realpathSync(stateRoot)
        const canonicalHostBundle = fs.realpathSync(hostBundle)
        if (!seeded.corePath.startsWith(path.join(canonicalStateRoot, 'components'))) throw new Error(`Seed core is not managed: ${seeded.corePath}`)
        if (
            !seeded.components.artifactWorker ||
            !fs.realpathSync(seeded.components.artifactWorker.path).startsWith(path.join(canonicalHostBundle, 'Contents'))
        ) {
            throw new Error(`artifactWorker is not host-bound: ${seeded.components.artifactWorker?.path ?? 'missing'} (host ${canonicalHostBundle})`)
        }
        const bundleVersionBefore = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(hostBundle, 'Contents', 'Info.plist')])

        const manifest2 = writeHybridManifest(root, dist, hostBundle, '1.0.1', 2, 2)
        prepareUpdate(bootstrapper, stateRoot, hostBundle, appExecutable, seedLease, manifest2, '1.0.0', dist)
        const lease2 = await handoff(bootstrapper, stateRoot, hostBundle, appExecutable, seedLease)
        livePid = lease2.pid
        const pending2 = resolveRuntime(bootstrapper, stateRoot, hostBundle, lease2)
        if (pending2.activationState !== 'pending' || pending2.coreVersion !== '1.0.1') throw new Error('revision 2 was not pending')
        acknowledgeRuntime(bootstrapper, stateRoot, hostBundle, lease2, pending2.generation)
        const confirmed2 = resolveRuntime(bootstrapper, stateRoot, hostBundle, lease2)
        if (confirmed2.activationState !== 'confirmed' || confirmed2.coreVersion !== '1.0.1') throw new Error('revision 2 was not confirmed')

        const manifest3 = writeHybridManifest(root, dist, hostBundle, '1.0.2', 3, 3)
        prepareUpdate(bootstrapper, stateRoot, hostBundle, appExecutable, lease2, manifest3, '1.0.1', dist)
        const lease3 = await handoff(bootstrapper, stateRoot, hostBundle, appExecutable, lease2)
        livePid = lease3.pid
        const pending3 = resolveRuntime(bootstrapper, stateRoot, hostBundle, lease3)
        if (pending3.coreVersion !== '1.0.2' || pending3.activationState !== 'pending') throw new Error('revision 3 was not pending')
        terminate(lease3.pid)
        livePid = null
        await waitFor(() => {
            try {
                process.kill(lease3.pid, 0)
                return null
            } catch {
                return true
            }
        }, 'failed successor exit')
        const restart = JSON.parse(
            run(bootstrapper, [
                'start',
                '--json',
                '--state-root',
                stateRoot,
                '--host-bundle',
                hostBundle,
                '--app-executable',
                appExecutable,
                '--app-executable-name',
                'Contents/MacOS/PulseSync',
            ]),
        ) as { state: string }
        if (restart.state !== 'launched') throw new Error(`Rollback restart failed: ${JSON.stringify(restart)}`)
        const lease4 = await waitFor(() => {
            const lease = readLease(stateRoot)
            return lease && lease.pid !== lease3.pid ? lease : null
        }, 'rollback successor lease')
        livePid = lease4.pid
        const rolledBack = resolveRuntime(bootstrapper, stateRoot, hostBundle, lease4)
        if (rolledBack.coreVersion !== '1.0.1' || rolledBack.activationState !== 'confirmed') {
            throw new Error(`Failed core did not roll back: ${JSON.stringify(rolledBack)}`)
        }
        const manifest4 = writeHybridManifest(root, dist, hostBundle, '1.0.2', 3, 4)
        createIncomingHostBundle(root, hostBundle, dist, manifest4, '1.1.0', 2, '1.0.2', 3, 4)
        prepareUpdate(bootstrapper, stateRoot, hostBundle, appExecutable, lease4, manifest4, '1.0.1', dist)
        const bundledBootstrapper = path.join(hostBundle, 'Contents', 'Resources', 'bootstrapper', 'pulsesync-bootstrapper')
        const hostHandoff = await macosHostHandoff(bundledBootstrapper, stateRoot, hostBundle, appExecutable, lease4)
        livePid = hostHandoff.lease.pid
        const pendingHost = resolveRuntime(bootstrapper, stateRoot, hostBundle, hostHandoff.lease)
        if (pendingHost.coreVersion !== '1.0.2' || pendingHost.activationState !== 'pending') {
            throw new Error(`Combined host/core update was not pending: ${JSON.stringify(pendingHost)}`)
        }
        acknowledgeRuntime(bootstrapper, stateRoot, hostBundle, hostHandoff.lease, pendingHost.generation)
        await waitFor(() => {
            const transaction = JSON.parse(fs.readFileSync(hostHandoff.transactionFile, 'utf8')) as { state: string }
            return transaction.state === 'complete' ? true : null
        }, 'combined host/core finalization', 20_000)
        const confirmedHost = resolveRuntime(bootstrapper, stateRoot, hostBundle, hostHandoff.lease)
        if (confirmedHost.coreVersion !== '1.0.2' || confirmedHost.activationState !== 'confirmed') {
            throw new Error('Combined host/core update was not confirmed')
        }
        const manifest5 = writeHybridManifest(root, dist, hostBundle, '1.0.3', 4, 5)
        createIncomingHostBundle(root, hostBundle, dist, manifest5, '1.2.0', 3, '1.0.3', 4, 5)
        prepareUpdate(bootstrapper, stateRoot, hostBundle, appExecutable, hostHandoff.lease, manifest5, '1.0.2', dist)
        const failedHostHandoff = await macosHostHandoff(bundledBootstrapper, stateRoot, hostBundle, appExecutable, hostHandoff.lease)
        livePid = failedHostHandoff.lease.pid
        const failedHostPending = resolveRuntime(bootstrapper, stateRoot, hostBundle, failedHostHandoff.lease)
        if (failedHostPending.coreVersion !== '1.0.3' || failedHostPending.activationState !== 'pending') {
            throw new Error('Combined failure fixture did not reach pending runtime')
        }
        await waitFor(() => {
            const transaction = JSON.parse(fs.readFileSync(failedHostHandoff.transactionFile, 'utf8')) as { state: string }
            return transaction.state === 'rolled-back' ? true : null
        }, 'combined host/core rollback', 45_000)
        const rollbackRestart = JSON.parse(
            run(bundledBootstrapper, [
                'start',
                '--json',
                '--state-root',
                stateRoot,
                '--host-bundle',
                hostBundle,
                '--app-executable',
                appExecutable,
                '--app-executable-name',
                'Contents/MacOS/PulseSync',
            ]),
        ) as { state: string }
        if (rollbackRestart.state !== 'launched') {
            throw new Error(`Combined rollback restart failed: ${JSON.stringify(rollbackRestart)}`)
        }
        const recoveredHostLease = await waitFor(() => {
            const candidate = readLease(stateRoot)
            return candidate && candidate.pid !== failedHostHandoff.lease.pid ? candidate : null
        }, 'combined rollback successor lease', 20_000)
        livePid = recoveredHostLease.pid
        const recoveredHost = resolveRuntime(bootstrapper, stateRoot, hostBundle, recoveredHostLease)
        if (recoveredHost.coreVersion !== '1.0.2' || recoveredHost.activationState !== 'confirmed') {
            throw new Error(`Combined host/core rollback did not restore known-good: ${JSON.stringify(recoveredHost)}`)
        }
        const bundleVersionAfter = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(hostBundle, 'Contents', 'Info.plist')])
        if (bundleVersionBefore !== '1' || bundleVersionAfter !== '2') throw new Error('Host bundle identity did not advance exactly once')
        const state = JSON.parse(fs.readFileSync(path.join(stateRoot, 'runtime', 'install-state.json'), 'utf8')) as {
            schemaVersion: number
            latest: { components: { desktopCore: { revision: number } } }
        }
        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    installStateSchema: state.schemaVersion,
                    confirmedRevision: state.latest.components.desktopCore.revision,
                    coreOnlyBundleVersion: bundleVersionBefore,
                    hostBundleVersion: bundleVersionAfter,
                    seedCorePath: seeded.corePath,
                    rollbackCoreVersion: rolledBack.coreVersion,
                    combinedCoreVersion: confirmedHost.coreVersion,
                    combinedRollbackCoreVersion: recoveredHost.coreVersion,
                },
                null,
                4,
            ),
        )
    } finally {
        terminate(livePid)
        terminate(processHandle)
        fs.rmSync(root, { recursive: true, force: true })
    }
}

main().catch(error => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
})
