import path from 'node:path'
import { app } from 'electron'
import { registerSchemes } from './main/utils/serverUtils'
import { createBootstrapWindow, type BootstrapWindowController } from './main/modules/bootstrap/bootstrapWindow'
import { LaunchInbox } from './main/modules/bootstrap/launchInbox'
import { createLaunchRequestInput, createLocalLaunchEnvelope, LaunchQueue } from './main/modules/bootstrap/launchQueue'
import { StartupCoordinator, type ApplicationBootstrapRuntime, type ApplicationStartupHandle } from './main/modules/bootstrap/startupCoordinator'
import { claimActiveApp } from './main/modules/bootstrapper/runtimeCommands'
import { getBootstrapperRuntimePaths } from './main/modules/bootstrapper/paths'
import { initMainErrorTracking } from './main/modules/errorTracking'
import { handleUncaughtException } from './main/modules/handlers/handleError'

declare const __non_vite_require__: (moduleId: string) => {
    startMainApplication(context?: {
        bootstrapRuntime?: ApplicationBootstrapRuntime
        bootstrapWindow?: Electron.BrowserWindow
    }): Promise<ApplicationStartupHandle>
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
        launchQueue.enqueue(
            createLaunchRequestInput({
                additionalData,
                argv: commandLine,
                kind: commandLine.length > 0 ? 'arguments' : 'activate',
                workingDirectory,
            }),
        )
    })
}

function loadApplicationMain(
    bootstrapWindow?: Electron.BrowserWindow,
    bootstrapRuntime?: ApplicationBootstrapRuntime,
): Promise<ApplicationStartupHandle> {
    const applicationMain = __non_vite_require__(path.join(__dirname, 'index.cjs'))
    return applicationMain.startMainApplication({ bootstrapRuntime, bootstrapWindow })
}

async function showCanonicalLaunchRequired(window: BootstrapWindowController): Promise<void> {
    window.publish({
        schemaVersion: 1,
        phase: 'error',
        statusKey: 'canonical-launch-required',
        progress: { kind: 'indeterminate' },
        actions: [],
    })
    await new Promise(resolve => setTimeout(resolve, 4_000))
    app.quit()
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
    await app.whenReady()
    const bootstrapWindow = await createBootstrapWindow()
    const runtimePaths = getBootstrapperRuntimePaths()
    if (!runtimePaths.launcher) {
        await showCanonicalLaunchRequired(bootstrapWindow)
        return
    }

    const launchReservationId = process.env.PULSESYNC_LAUNCH_RESERVATION_ID
    const handoffId = process.env.PULSESYNC_HANDOFF_ID
    if (app.isPackaged && !launchReservationId && process.platform !== 'darwin') {
        await showCanonicalLaunchRequired(bootstrapWindow)
        return
    }

    const claim = await claimActiveApp({
        stateRoot: runtimePaths.stateRoot,
        hostBundle: runtimePaths.hostBundle,
        appExecutable: runtimePaths.appExecutable,
        launcher: runtimePaths.launcher,
        launchReservationId,
        handoffId,
        allowUnreservedRecovery: !app.isPackaged || process.platform === 'darwin',
    }).catch(async () => null)
    if (!claim || claim.state !== 'claimed') {
        await showCanonicalLaunchRequired(bootstrapWindow)
        return
    }

    const isFirstInstance = allowSecondInstance || app.requestSingleInstanceLock()
    if (!isFirstInstance) {
        bootstrapWindow.destroy()
        app.quit()
        return
    }
    registerSecondInstanceDelivery()

    const inbox = new LaunchInbox({ stateRoot: runtimePaths.stateRoot, launcher: runtimePaths.launcher, lease: claim.lease })
    await launchQueue.bindSink(input => inbox.enqueue(input))
    const coordinator = new StartupCoordinator({
        bootstrapWindow,
        inbox,
        lease: claim.lease,
        loadApplicationMain: (window, bootstrapRuntime) => loadApplicationMain(window, bootstrapRuntime),
        queue: launchQueue,
        runtimePaths,
    })
    await coordinator.run()
}

void (app.isPackaged || enableDevUpdater ? startPackagedBootstrap() : startDevelopmentApplication()).catch(error => {
    console.error('PulseSync bootstrap failed', error)
    app.quit()
})
