import path from 'node:path'
import { app } from 'electron'
import type { BootstrapStatusKey } from '@common/types/bootstrapEvents'
import type { ActiveRuntimeV2 } from '@common/desktopRuntime/contract'
import { registerSchemes } from './main/utils/serverUtils'
import { createBootstrapWindow, type BootstrapWindowController } from './main/modules/bootstrap/bootstrapWindow'
import { LaunchInbox } from './main/modules/bootstrap/launchInbox'
import { createLaunchRequestInput, createLocalLaunchEnvelope, LaunchQueue } from './main/modules/bootstrap/launchQueue'
import { StartupCoordinator, type ApplicationBootstrapRuntime, type ApplicationStartupHandle } from './main/modules/bootstrap/startupCoordinator'
import {
    canonicalStartSucceeded,
    claimShouldUseCanonicalStart,
    normalizeSecondInstanceArgv,
    requiresCanonicalStart,
} from './main/modules/bootstrapper/launchRouting'
import { getBootstrapperRuntimePaths, type BootstrapperRuntimePaths } from './main/modules/bootstrapper/paths'
import { claimActiveApp, resolveActiveRuntime, startCanonicalApp } from './main/modules/bootstrapper/runtimeCommands'
import { initMainErrorTracking } from './main/modules/errorTracking'
import { handleUncaughtException } from './main/modules/handlers/handleError'

declare const __non_vite_require__: (moduleId: string) => {
    startup(context?: { bootstrapRuntime?: ApplicationBootstrapRuntime; bootstrapWindow?: Electron.BrowserWindow }): Promise<ApplicationStartupHandle>
}

registerSchemes()
initMainErrorTracking()
handleUncaughtException()

const launchQueue = new LaunchQueue()
const allowSecondInstance = !app.isPackaged && process.env.PULSESYNC_ALLOW_SECOND_INSTANCE === '1'
const enableDevUpdater = process.env.PULSESYNC_ENABLE_DEV_UPDATER === '1'

launchQueue.enqueue(
    createLaunchRequestInput({
        argv: process.argv.slice(1),
        kind: process.argv.length > 1 ? 'arguments' : 'activate',
        workingDirectory: process.cwd(),
    }),
)

app.on('open-url', (event, url) => {
    event.preventDefault()
    launchQueue.enqueue(createLaunchRequestInput({ argv: [url], kind: 'arguments' }))
})

app.on('open-file', (event, filePath) => {
    event.preventDefault()
    launchQueue.enqueue(createLaunchRequestInput({ argv: [filePath], kind: 'arguments' }))
})

function registerSecondInstanceDelivery(): void {
    app.on('second-instance', (_event, commandLine, workingDirectory, additionalData) => {
        const argv = normalizeSecondInstanceArgv(commandLine, app.isPackaged)
        launchQueue.enqueue(
            createLaunchRequestInput({
                additionalData,
                argv,
                kind: argv.length > 0 ? 'arguments' : 'activate',
                workingDirectory,
            }),
        )
    })
}

function loadApplicationMain(
    bootstrapWindow?: Electron.BrowserWindow,
    bootstrapRuntime?: ApplicationBootstrapRuntime,
    activeRuntime?: ActiveRuntimeV2,
): Promise<ApplicationStartupHandle> {
    const coreEntry = app.isPackaged ? activeRuntime?.corePath : path.join(__dirname, 'desktopCore.cjs')
    if (!coreEntry) throw new Error('Resolved desktop core path is missing')
    if (activeRuntime) process.env.PULSESYNC_ACTIVE_COMPONENTS_JSON = JSON.stringify(activeRuntime.components)
    console.info('Loading PulseSync desktop core', { coreEntry, activeRuntime })
    const desktopCore = __non_vite_require__(coreEntry)
    return desktopCore.startup({ bootstrapRuntime, bootstrapWindow })
}

async function showBootstrapFailure(
    window: BootstrapWindowController,
    statusKey: Extract<BootstrapStatusKey, 'bootstrapper-missing' | 'launch-blocked' | 'launch-failed'>,
): Promise<void> {
    window.publish({
        schemaVersion: 1,
        phase: 'error',
        statusKey,
        progress: { kind: 'indeterminate' },
        actions: [],
    })
    await new Promise(resolve => setTimeout(resolve, 4_000))
    app.quit()
}

async function routeThroughCanonicalStart(runtimePaths: BootstrapperRuntimePaths): Promise<void> {
    const launcher = runtimePaths.launcher
    if (!launcher) {
        const bootstrapWindow = await createBootstrapWindow()
        await showBootstrapFailure(bootstrapWindow, 'bootstrapper-missing')
        return
    }

    app.releaseSingleInstanceLock()
    try {
        const result = await startCanonicalApp({
            appExecutable: runtimePaths.appExecutable,
            appExecutableName: runtimePaths.appExecutableName,
            hostBundle: runtimePaths.hostBundle,
            launcher,
            passthrough: process.argv.slice(1),
            stateRoot: runtimePaths.stateRoot,
        })
        if (canonicalStartSucceeded(result)) {
            app.quit()
            return
        }
        console.error('Canonical PulseSync start was blocked', result)
        const bootstrapWindow = await createBootstrapWindow()
        await showBootstrapFailure(bootstrapWindow, result.state === 'blocked' || result.state === 'busy' ? 'launch-blocked' : 'launch-failed')
    } catch (error) {
        console.error('Canonical PulseSync start failed', error)
        const bootstrapWindow = await createBootstrapWindow()
        await showBootstrapFailure(bootstrapWindow, 'launch-failed')
    }
}

async function startDevelopmentApplication(): Promise<void> {
    const isFirstInstance = allowSecondInstance || app.requestSingleInstanceLock()
    if (!isFirstInstance) {
        app.quit()
        return
    }
    registerSecondInstanceDelivery()
    await app.whenReady()
    const handle = await loadApplicationMain()
    let localSequence = 0
    await launchQueue.bindSink(async input => {
        localSequence += 1
        await handle.deliverLaunchRequest(createLocalLaunchEnvelope(input, localSequence))
    })
    await handle.ready
}

async function startPackagedBootstrap(): Promise<void> {
    const isFirstInstance = allowSecondInstance || app.requestSingleInstanceLock()
    if (!isFirstInstance) {
        app.quit()
        return
    }
    registerSecondInstanceDelivery()
    await app.whenReady()
    const runtimePaths = getBootstrapperRuntimePaths()
    if (!runtimePaths.launcher) {
        const bootstrapWindow = await createBootstrapWindow()
        await showBootstrapFailure(bootstrapWindow, 'bootstrapper-missing')
        return
    }

    const launchReservationId = process.env.PULSESYNC_LAUNCH_RESERVATION_ID
    const handoffId = process.env.PULSESYNC_HANDOFF_ID
    if (
        requiresCanonicalStart({
            handoffId,
            isPackaged: app.isPackaged,
            launchReservationId,
            platform: process.platform,
        })
    ) {
        await routeThroughCanonicalStart(runtimePaths)
        return
    }

    const bootstrapWindow = await createBootstrapWindow()
    let claim
    try {
        claim = await claimActiveApp({
            stateRoot: runtimePaths.stateRoot,
            hostBundle: runtimePaths.hostBundle,
            appExecutable: runtimePaths.appExecutable,
            launcher: runtimePaths.launcher,
            launchReservationId,
            handoffId,
            allowUnreservedRecovery: !app.isPackaged || process.platform === 'darwin',
        })
    } catch (error) {
        console.error('PulseSync active-app claim failed', error)
        await showBootstrapFailure(bootstrapWindow, 'launch-failed')
        return
    }

    if (claimShouldUseCanonicalStart(claim)) {
        bootstrapWindow.destroy()
        await routeThroughCanonicalStart(runtimePaths)
        return
    }
    if (claim.state !== 'claimed') {
        console.error('PulseSync active-app claim was blocked', claim.block)
        await showBootstrapFailure(bootstrapWindow, 'launch-blocked')
        return
    }

    const inbox = new LaunchInbox({ stateRoot: runtimePaths.stateRoot, launcher: runtimePaths.launcher, lease: claim.lease })
    const activeRuntime = await resolveActiveRuntime({
        activeLeaseId: claim.lease.leaseId,
        launcher: runtimePaths.launcher,
        stateRoot: runtimePaths.stateRoot,
    })
    await launchQueue.bindSink(input => inbox.enqueue(input))
    const coordinator = new StartupCoordinator({
        activeRuntime,
        bootstrapWindow,
        inbox,
        lease: claim.lease,
        loadApplicationMain: (window, bootstrapRuntime, activeRuntime) => loadApplicationMain(window, bootstrapRuntime, activeRuntime),
        queue: launchQueue,
        runtimePaths,
    })
    await coordinator.run()
}

void (app.isPackaged || enableDevUpdater ? startPackagedBootstrap() : startDevelopmentApplication()).catch(error => {
    console.error('PulseSync bootstrap failed', error)
    app.quit()
})
