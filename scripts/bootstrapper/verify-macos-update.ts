import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')

function run(program: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
    const result = spawnSync(program, args, {
        cwd: options.cwd ?? projectRoot,
        env: { ...process.env, ...options.env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0) {
        throw new Error(`${program} failed (${result.status ?? 'signal'}): ${result.stderr || result.stdout}`)
    }
    return result.stdout.trim()
}

function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const started = Date.now()
    return new Promise((resolve, reject) => {
        const poll = (): void => {
            if (predicate()) {
                resolve()
                return
            }
            if (Date.now() - started >= timeoutMs) {
                reject(new Error(`Timed out waiting for ${label}`))
                return
            }
            setTimeout(poll, 50)
        }
        poll()
    })
}

function plist(desktopVersion: string, bundleVersion: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PulseSync</string>
<key>CFBundleIdentifier</key><string>app.pulsesync.fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${desktopVersion}</string>
<key>CFBundleVersion</key><string>${bundleVersion}</string>
</dict></plist>
`
}

function createBundle(
    root: string,
    desktopVersion: string,
    bundleVersion: string,
    fixtureExecutable: string,
    bootstrapper: string,
    stateRoot: string,
    claimDelayMs = 0,
): string {
    const bundle = path.join(root, 'PulseSync.app')
    const contents = path.join(bundle, 'Contents')
    const executable = path.join(contents, 'MacOS', 'PulseSync')
    const resources = path.join(contents, 'Resources')
    const seed = path.join(resources, 'bootstrapper', 'pulsesync-bootstrapper')
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.mkdirSync(path.dirname(seed), { recursive: true })
    fs.copyFileSync(fixtureExecutable, executable)
    fs.copyFileSync(bootstrapper, seed)
    fs.chmodSync(executable, 0o755)
    fs.chmodSync(seed, 0o755)
    fs.writeFileSync(path.join(contents, 'Info.plist'), plist(desktopVersion, bundleVersion))
    fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????')
    fs.writeFileSync(
        path.join(resources, 'pulsesync-runtime.json'),
        `${JSON.stringify({ schemaVersion: 3, hostVersion: desktopVersion, desktopVersion, bundleVersion, components: {} }, null, 4)}\n`,
    )
    fs.writeFileSync(path.join(resources, 'fixture-state-root.txt'), `${stateRoot}\n`)
    fs.writeFileSync(path.join(resources, 'fixture-version.txt'), `${desktopVersion}\n`)
    fs.writeFileSync(path.join(resources, 'fixture-claim-delay-ms.txt'), `${claimDelayMs}\n`)
    return bundle
}

function sha256(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function main(): Promise<void> {
    if (process.platform !== 'darwin') {
        throw new Error('verify-macos-update is only supported on macOS')
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-macos-e2e-'))
    const withLaunchAgent = process.argv.includes('--with-launch-agent')
    const killHelperAfterExchange = process.argv.includes('--kill-helper-after-exchange')
    const killHelperAfterAck = process.argv.includes('--kill-helper-after-ack')
    if ((killHelperAfterExchange || killHelperAfterAck) && !withLaunchAgent) {
        throw new Error('helper crash injection requires --with-launch-agent')
    }
    if (killHelperAfterExchange && killHelperAfterAck) {
        throw new Error('select only one helper crash injection point')
    }
    const stateRoot = path.join(root, 'state')
    const applications = path.join(root, 'Applications')
    const source = path.join(projectRoot, 'scripts', 'bootstrapper', 'fixtures', 'macos-host.rs')
    const fixtureExecutable = path.join(root, 'fixture-host')
    const dist = `darwin-${process.arch}`
    const profile = withLaunchAgent ? 'release' : 'debug'
    const bootstrapper = path.join(projectRoot, 'packages', 'bootstrapper', 'target', profile, 'pulsesync-bootstrapper')
    let oldPid: number | null = null
    let newPid: number | null = null
    let helperPid: number | null = null
    let transactionFile: string | null = null
    try {
        if (!fs.existsSync(bootstrapper)) throw new Error(`${profile} bootstrapper is missing: ${bootstrapper}`)
        run('rustc', ['--edition', '2024', source, '-o', fixtureExecutable])
        fs.mkdirSync(applications, { recursive: true })
        const hostBundle = createBundle(applications, '1.0.0', '1', fixtureExecutable, bootstrapper, stateRoot)
        const appExecutable = path.join(hostBundle, 'Contents', 'MacOS', 'PulseSync')
        const old = spawn(appExecutable, [], { detached: false, stdio: 'ignore' })
        oldPid = old.pid ?? null
        if (!oldPid) throw new Error('Failed to start version A fixture')
        const activeLeasePath = path.join(stateRoot, 'runtime', 'active-app.json')
        await waitFor(() => fs.existsSync(activeLeasePath), 10_000, 'version A active lease')
        const activeLease = JSON.parse(fs.readFileSync(activeLeasePath, 'utf8')) as { leaseId: string }
        const launchedVersionPath = path.join(stateRoot, 'fixture-launched-version.txt')
        await waitFor(() => fs.existsSync(launchedVersionPath), 10_000, 'version A launch marker')
        if (fs.readFileSync(launchedVersionPath, 'utf8').trim() !== '1.0.0') {
            throw new Error('Version A did not launch')
        }

        const incomingRoot = path.join(root, 'incoming')
        fs.mkdirSync(incomingRoot, { recursive: true })
        const incomingBundle = createBundle(
            incomingRoot,
            '2.0.0',
            '2',
            fixtureExecutable,
            bootstrapper,
            stateRoot,
            killHelperAfterExchange ? 5_000 : killHelperAfterAck ? 1_000 : 0,
        )
        const archive = path.join(root, `pulsesync-host-bundle-2-${dist}.zip`)
        run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', incomingBundle, archive])
        const manifest = path.join(root, 'manifest.json')
        fs.writeFileSync(
            manifest,
            `${JSON.stringify(
                {
                    schemaVersion: 3,
                    metadataVersion: 2,
                    bundleVersion: '2',
                    channel: 'dev',
                    desktopVersion: '2.0.0',
                    desktopApi: '1.0.0',
                    targets: {
                        [dist]: {
                            layout: 'macos-bundle',
                            host: {
                                version: '2.0.0',
                                required: true,
                                artifact: { url: archive, sha256: sha256(archive), size: fs.statSync(archive).size },
                            },
                            components: {},
                        },
                    },
                },
                null,
                4,
            )}\n`,
        )

        const prepare = JSON.parse(
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
                '1.0.0',
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
                activeLease.leaseId,
            ]),
        ) as { state: string; transaction: { file: string } }
        if (prepare.state !== 'prepared') throw new Error(`Update did not prepare: ${JSON.stringify(prepare)}`)
        transactionFile = prepare.transaction.file

        const start = spawn(
            path.join(hostBundle, 'Contents', 'Resources', 'bootstrapper', 'pulsesync-bootstrapper'),
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
                String(oldPid),
                '--active-lease-id',
                activeLease.leaseId,
                '--wait-timeout-ms',
                '10000',
            ],
            {
                env: {
                    ...process.env,
                    ...(withLaunchAgent ? {} : { PULSESYNC_DISABLE_LAUNCH_AGENT: '1' }),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        )
        let stderr = ''
        start.stderr.setEncoding('utf8')
        start.stderr.on('data', chunk => {
            stderr += String(chunk)
            if (stderr.includes('"event":"handoff-armed"') && oldPid) {
                process.kill(oldPid, 'SIGTERM')
                oldPid = null
            }
        })
        const startOutput = await new Promise<string>((resolve, reject) => {
            let stdout = ''
            start.stdout.setEncoding('utf8')
            start.stdout.on('data', chunk => (stdout += String(chunk)))
            start.once('error', reject)
            start.once('close', code => {
                if (code === 0) {
                    resolve(stdout)
                    return
                }
                const helperErrorPath = path.join(stateRoot, 'updates', 'self-update-handoff-error.json')
                const helperError = fs.existsSync(helperErrorPath) ? `\nhelper error:\n${fs.readFileSync(helperErrorPath, 'utf8')}` : ''
                let transaction = ''
                if (fs.existsSync(prepare.transaction.file)) {
                    const raw = fs.readFileSync(prepare.transaction.file, 'utf8')
                    const value = JSON.parse(raw) as { archivePath?: string; commitSlot?: string; hostBundle?: string }
                    const paths = [
                        value.archivePath,
                        value.commitSlot,
                        value.commitSlot && path.join(value.commitSlot, 'Contents', 'Info.plist'),
                        value.commitSlot && path.join(value.commitSlot, 'Contents', 'Resources', 'pulsesync-runtime.json'),
                        value.commitSlot && path.join(value.commitSlot, 'Contents', 'Resources', 'bootstrapper', 'pulsesync-bootstrapper'),
                        value.hostBundle,
                    ].filter((candidate): candidate is string => Boolean(candidate))
                    transaction = `\ntransaction paths:\n${paths.map(candidate => `${fs.existsSync(candidate) ? 'exists' : 'missing'} ${candidate}`).join('\n')}\ntransaction:\n${raw}`
                }
                reject(new Error(`start failed (${code}): ${stderr}\n${stdout}${helperError}${transaction}`))
            })
        })
        const startResult = JSON.parse(startOutput) as { state: string; handoffPid?: number }
        if (startResult.state !== 'reserved') throw new Error(`Handoff was not reserved: ${startOutput}`)
        if (!startResult.handoffPid) throw new Error(`Handoff helper pid is missing: ${startOutput}`)
        helperPid = startResult.handoffPid

        if (killHelperAfterExchange) {
            await waitFor(() => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).state === 'verified', 20_000, 'verified exchange')
            process.kill(startResult.handoffPid, 'SIGKILL')
            await waitFor(() => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).state === 'rolled-back', 20_000, 'LaunchAgent rollback')
            await waitFor(
                () =>
                    fs.existsSync(path.join(stateRoot, 'fixture-launched-version.txt')) &&
                    fs.readFileSync(path.join(stateRoot, 'fixture-launched-version.txt'), 'utf8').trim() === '1.0.0',
                20_000,
                'version A recovery launch',
            )
            const recoveredLease = JSON.parse(fs.readFileSync(activeLeasePath, 'utf8')) as { pid: number }
            newPid = recoveredLease.pid
            if (
                run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(hostBundle, 'Contents', 'Info.plist')]) !==
                '1.0.0'
            ) {
                throw new Error('LaunchAgent recovery did not restore version A')
            }
            if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(hostBundle, 'Contents', 'Info.plist')]) !== '1') {
                throw new Error('LaunchAgent recovery did not restore bundle identity 1')
            }
            console.log(
                JSON.stringify(
                    {
                        state: 'ok',
                        transactionState: 'rolled-back',
                        hostVersion: '1.0.0',
                        recovery: 'external-helper-killed-after-exchange',
                        launchAgent: 'reconciled-and-cleaned',
                    },
                    null,
                    4,
                ),
            )
            return
        }

        if (killHelperAfterAck) {
            await waitFor(() => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).state === 'verified', 20_000, 'verified exchange')
            const processStartedPath = path.join(stateRoot, 'fixture-process-started-version.txt')
            await waitFor(
                () => fs.existsSync(processStartedPath) && fs.readFileSync(processStartedPath, 'utf8').trim() === '2.0.0',
                20_000,
                'version B process start before claim',
            )
            await waitFor(
                () => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).successorReadyForClaim === true,
                20_000,
                'version B successor readiness',
            )
            process.kill(startResult.handoffPid, 'SIGSTOP')
            await waitFor(
                () => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).startupAcknowledged === true,
                20_000,
                'version B startup acknowledgement',
            )
            process.kill(startResult.handoffPid, 'SIGKILL')
            await waitFor(() => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).state === 'complete', 20_000, 'resumed finalization')
            const finalLease = JSON.parse(fs.readFileSync(activeLeasePath, 'utf8')) as { pid: number }
            newPid = finalLease.pid
            if (
                run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(hostBundle, 'Contents', 'Info.plist')]) !==
                '2.0.0'
            ) {
                throw new Error('Acknowledged version B was rolled back after helper crash')
            }
            if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(hostBundle, 'Contents', 'Info.plist')]) !== '2') {
                throw new Error('Acknowledged bundle identity 2 was rolled back after helper crash')
            }
            console.log(
                JSON.stringify(
                    {
                        state: 'ok',
                        transactionState: 'complete',
                        hostVersion: '2.0.0',
                        recovery: 'external-helper-killed-after-startup-ack',
                        launchAgent: 'resumed-finalization-and-cleaned',
                    },
                    null,
                    4,
                ),
            )
            return
        }

        await waitFor(
            () =>
                fs.existsSync(path.join(stateRoot, 'fixture-launched-version.txt')) &&
                fs.readFileSync(path.join(stateRoot, 'fixture-launched-version.txt'), 'utf8').trim() === '2.0.0',
            20_000,
            'version B launch',
        )
        await waitFor(() => JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')).state === 'complete', 20_000, 'complete transaction')
        const finalLease = JSON.parse(fs.readFileSync(activeLeasePath, 'utf8')) as { pid: number }
        newPid = finalLease.pid
        if (
            run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(hostBundle, 'Contents', 'Info.plist')]) !== '2.0.0'
        ) {
            throw new Error('Host bundle did not switch to version B')
        }
        if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(hostBundle, 'Contents', 'Info.plist')]) !== '2') {
            throw new Error('Host bundle did not switch to bundle identity 2')
        }
        const transaction = JSON.parse(fs.readFileSync(prepare.transaction.file, 'utf8')) as { backupDir: string; commitSlot: string; state: string }
        if (fs.existsSync(transaction.commitSlot)) throw new Error('Transient commit slot was not removed')
        if (
            run('/usr/libexec/PlistBuddy', [
                '-c',
                'Print :CFBundleShortVersionString',
                path.join(transaction.backupDir, 'Contents', 'Info.plist'),
            ]) !== '1.0.0'
        ) {
            throw new Error('Previous bundle was not retained')
        }
        if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(transaction.backupDir, 'Contents', 'Info.plist')]) !== '1') {
            throw new Error('Previous bundle identity was not retained')
        }
        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    transactionState: transaction.state,
                    hostVersion: '2.0.0',
                    retainedVersion: '1.0.0',
                    stateRoot,
                    hostBundle,
                    transactionFile: prepare.transaction.file,
                    launchAgent: withLaunchAgent ? 'registered-and-cleaned' : 'disabled-for-sandbox',
                },
                null,
                4,
            ),
        )
    } finally {
        if (helperPid) {
            try {
                process.kill(helperPid, 'SIGKILL')
            } catch {}
        }
        if (transactionFile && fs.existsSync(transactionFile)) {
            try {
                await waitFor(
                    () => ['complete', 'rolled-back'].includes(JSON.parse(fs.readFileSync(transactionFile!, 'utf8')).state),
                    10_000,
                    'terminal transaction cleanup',
                )
            } catch {}
        }
        if (oldPid) {
            try {
                process.kill(oldPid, 'SIGTERM')
            } catch {}
        }
        if (newPid) {
            try {
                process.kill(newPid, 'SIGTERM')
            } catch {}
        }
        const activeLeasePath = path.join(stateRoot, 'runtime', 'active-app.json')
        if (fs.existsSync(activeLeasePath)) {
            try {
                const lease = JSON.parse(fs.readFileSync(activeLeasePath, 'utf8')) as { pid?: number }
                if (lease.pid) process.kill(lease.pid, 'SIGTERM')
            } catch {}
        }
        if (transactionFile && fs.existsSync(transactionFile)) {
            try {
                const transaction = JSON.parse(fs.readFileSync(transactionFile, 'utf8')) as {
                    recoveryAgentLabel?: string
                    recoveryAgentPlist?: string
                }
                if (transaction.recoveryAgentLabel) {
                    spawnSync('/bin/launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}/${transaction.recoveryAgentLabel}`], { stdio: 'ignore' })
                }
                if (transaction.recoveryAgentPlist) fs.rmSync(transaction.recoveryAgentPlist, { force: true })
            } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, 300))
        fs.rmSync(root, { recursive: true, force: true })
    }
}

main().catch(error => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
})
