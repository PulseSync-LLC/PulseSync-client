import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')
const moduleName = 'artifactWorker'
const moduleFileName = 'artifactWorker.cjs'
const targetVersion = '99.0.0-smoke'

type BootstrapperArtifact = {
    sha256: string
    size: number
    url: string
}

type InstallWorkflowResult = {
    applyResult?: {
        cleanup?: {
            removedAppVersions?: unknown
            state?: unknown
        }
        currentVersion?: unknown
        state?: unknown
    }
    installed?: unknown
    prepareResult?: {
        transactionDir?: unknown
    }
    state?: unknown
}

type RollbackResult = {
    artifacts?: Array<{
        key?: unknown
        rollbackStatus?: unknown
    }>
    currentVersionRestored?: {
        state?: unknown
    }
    state?: unknown
}

type ApplyResult = {
    cleanup?: {
        state?: unknown
    }
    currentVersion?: unknown
    previousCurrentVersion?: unknown
    state?: unknown
    transactionDir?: unknown
}

type PrepareResult = {
    state?: unknown
    transactionDir?: unknown
}

type BootstrapperStartResult = {
    firstRunInstall?: InstallWorkflowResult
    launched?: unknown
    pid?: unknown
    state?: unknown
    transactionAction?: unknown
}

function targetPlatform(): NodeJS.Platform {
    const platform = process.platform
    if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
        return platform
    }
    throw new Error(`Unsupported bootstrapper smoke platform: ${platform}`)
}

function targetArch(): string {
    if (process.arch === 'x64' || process.arch === 'arm64') {
        return process.arch
    }
    return process.arch
}

function dist(): string {
    return `${targetPlatform()}-${targetArch()}`
}

function appExecutableName(): string {
    const platform = targetPlatform()
    if (platform === 'win32') {
        return 'PulseSync.exe'
    }
    if (platform === 'darwin') {
        return path.join('MacOS', 'PulseSync')
    }
    return 'pulsesync'
}

function sha256File(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function artifactDescriptor(filePath: string): BootstrapperArtifact {
    return {
        url: pathToFileURL(filePath).href,
        sha256: sha256File(filePath),
        size: fs.statSync(filePath).size,
    }
}

function writeZip(sourceDir: string, archiveRoot: string, targetPath: string): void {
    const zip = new AdmZip()
    zip.addLocalFolder(sourceDir, archiveRoot)
    zip.writeZip(targetPath)
}

function tryChmodExecutable(filePath: string): void {
    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o755)
    }
}

function writeLaunchableAppExecutable(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (process.platform === 'win32') {
        fs.copyFileSync(process.execPath, filePath)
        return
    }

    fs.writeFileSync(filePath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8')
    tryChmodExecutable(filePath)
}

function createFixtureArtifacts(root: string): { appArchive: string; manifestPath: string; moduleArchive: string } {
    const artifactsRoot = path.join(root, 'artifacts')
    const appSourceDir = path.join(root, 'fixtures', 'app')
    const moduleSourceDir = path.join(root, 'fixtures', moduleName)
    const appExecutable = path.join(appSourceDir, appExecutableName())
    const moduleFile = path.join(moduleSourceDir, moduleFileName)
    const appArchive = path.join(artifactsRoot, `pulsesync-app-payload-${targetVersion}-${dist()}.zip`)
    const moduleArchive = path.join(artifactsRoot, `pulsesync-module-${moduleName}-${targetVersion}-${dist()}.zip`)
    const manifestPath = path.join(root, `desktop-update-${dist()}.json`)

    fs.mkdirSync(path.dirname(appExecutable), { recursive: true })
    fs.mkdirSync(moduleSourceDir, { recursive: true })
    fs.mkdirSync(artifactsRoot, { recursive: true })
    writeLaunchableAppExecutable(appExecutable)
    fs.writeFileSync(moduleFile, `module.exports = { smoke: true, dist: ${JSON.stringify(dist())} }\n`, 'utf-8')

    writeZip(appSourceDir, 'app', appArchive)
    writeZip(moduleSourceDir, path.join('modules', moduleName), moduleArchive)

    const manifest = {
        schemaVersion: 1,
        channel: 'smoke',
        clientVersion: targetVersion,
        rendererManifestUrl: 'https://pulsesync.dev/app/desktop/manifest.json',
        artifacts: {
            [dist()]: {
                app: artifactDescriptor(appArchive),
                modules: {
                    [moduleName]: artifactDescriptor(moduleArchive),
                },
            },
        },
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf-8')

    return { appArchive, manifestPath, moduleArchive }
}

function parseInstallWorkflowResult(stdout: string): InstallWorkflowResult {
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Expected install-workflow JSON object, got ${stdout}`)
    }
    return parsed as InstallWorkflowResult
}

function runBootstrapperJson<T>(args: string[]): T {
    const cargoManifest = path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')
    const stdout = execFileSync('cargo', ['run', '--quiet', '--manifest-path', cargoManifest, '--', ...args], {
        cwd: projectRoot,
        encoding: 'utf-8',
        windowsHide: true,
    })
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Expected bootstrapper JSON object, got ${stdout}`)
    }
    return parsed as T
}

function runInstallWorkflow(root: string, manifestPath: string): InstallWorkflowResult {
    const installRoot = path.join(root, 'install')
    const cargoManifest = path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')
    const stdout = execFileSync(
        'cargo',
        [
            'run',
            '--quiet',
            '--manifest-path',
            cargoManifest,
            '--',
            'install-workflow',
            '--json',
            '--install-root',
            installRoot,
            '--dist',
            dist(),
            '--installed-version',
            '0.0.0',
            '--manifest-url',
            pathToFileURL(manifestPath).href,
            '--app-executable-name',
            appExecutableName(),
        ],
        {
            cwd: projectRoot,
            encoding: 'utf-8',
            windowsHide: true,
        },
    )

    return parseInstallWorkflowResult(stdout)
}

function runUpdateApply(installRoot: string, manifestPath: string, installedVersion: string): ApplyResult {
    const stagingRoot = path.join(installRoot, 'updates', 'staging')
    const planFile = path.join(stagingRoot, 'install-plan.json')

    runBootstrapperJson<unknown>([
        'download',
        '--json',
        '--manifest-url',
        pathToFileURL(manifestPath).href,
        '--dist',
        dist(),
        '--installed-version',
        installedVersion,
        '--staging-dir',
        stagingRoot,
    ])
    const plan = runBootstrapperJson<unknown>([
        'plan-install',
        '--json',
        '--manifest-url',
        pathToFileURL(manifestPath).href,
        '--dist',
        dist(),
        '--installed-version',
        installedVersion,
        '--install-dir',
        installRoot,
        '--staging-dir',
        stagingRoot,
        '--retain-app-versions',
        '2',
    ])
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 4)}\n`, 'utf-8')
    const prepared = runBootstrapperJson<PrepareResult>([
        'prepare-install',
        '--json',
        '--plan-file',
        planFile,
    ])
    if (prepared.state !== 'prepared' || typeof prepared.transactionDir !== 'string') {
        throw new Error(`Expected prepare-install state=prepared, got ${JSON.stringify(prepared)}`)
    }
    const transactionFile = path.join(prepared.transactionDir, 'transaction.json')
    return runBootstrapperJson<ApplyResult>([
        'apply-install',
        '--json',
        '--transaction-file',
        transactionFile,
    ])
}

function runBootstrapperStart(installRoot: string, manifestPath: string): BootstrapperStartResult {
    const cargoManifest = path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')
    const passthroughArgs = process.platform === 'win32' ? ['-e', 'process.exit(0)', '--pulse-smoke-flag'] : ['--pulse-smoke-flag']
    const stdout = execFileSync(
        'cargo',
        [
            'run',
            '--quiet',
            '--manifest-path',
            cargoManifest,
            '--',
            'start',
            '--json',
            '--no-install-ui',
            '--install-root',
            installRoot,
            '--dist',
            dist(),
            '--installed-version',
            '0.0.0',
            '--manifest-url',
            pathToFileURL(manifestPath).href,
            '--app-executable-name',
            appExecutableName(),
            '--',
            ...passthroughArgs,
        ],
        {
            cwd: projectRoot,
            encoding: 'utf-8',
            windowsHide: true,
        },
    )

    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Expected start JSON object, got ${stdout}`)
    }
    return parsed as BootstrapperStartResult
}

function runRollback(transactionDir: unknown): RollbackResult {
    if (typeof transactionDir !== 'string' || transactionDir.trim().length === 0) {
        throw new Error(`Expected prepareResult.transactionDir, got ${JSON.stringify(transactionDir)}`)
    }

    const cargoManifest = path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')
    const stdout = execFileSync(
        'cargo',
        [
            'run',
            '--quiet',
            '--manifest-path',
            cargoManifest,
            '--',
            'rollback-install',
            '--json',
            '--transaction-file',
            path.join(transactionDir, 'transaction.json'),
        ],
        {
            cwd: projectRoot,
            encoding: 'utf-8',
            windowsHide: true,
        },
    )
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Expected rollback JSON object, got ${stdout}`)
    }
    return parsed as RollbackResult
}

function runRollbackFile(transactionFile: string): RollbackResult {
    return runBootstrapperJson<RollbackResult>([
        'rollback-install',
        '--json',
        '--transaction-file',
        transactionFile,
    ])
}

function requireFile(filePath: string): void {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Expected installed file: ${filePath}`)
    }
}

function rejectPath(targetPath: string): void {
    if (fs.existsSync(targetPath)) {
        throw new Error(`Expected path to be absent: ${targetPath}`)
    }
}

function createStaleAppVersion(installRoot: string, version: string): string {
    const stalePath = path.join(installRoot, `app-${version}`)
    fs.mkdirSync(stalePath, { recursive: true })
    fs.writeFileSync(path.join(stalePath, 'stale.txt'), `stale app version ${version}\n`, 'utf-8')
    return stalePath
}

function readCurrentVersion(installRoot: string, expectedVersion = targetVersion): string {
    const currentPath = path.join(installRoot, 'current.json')
    requireFile(currentPath)
    const current = JSON.parse(fs.readFileSync(currentPath, 'utf-8')) as { schemaVersion?: unknown; version?: unknown }
    if (current.schemaVersion !== 1 || current.version !== expectedVersion) {
        throw new Error(`Expected current.json to point at ${expectedVersion}, got ${JSON.stringify(current)}`)
    }
    return current.version as string
}

function writeCurrentVersion(installRoot: string, version: string): void {
    fs.mkdirSync(installRoot, { recursive: true })
    fs.writeFileSync(path.join(installRoot, 'current.json'), `${JSON.stringify({ schemaVersion: 1, version }, null, 4)}\n`, 'utf-8')
}

function main(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-bootstrapper-smoke-'))
    try {
        const { appArchive, manifestPath, moduleArchive } = createFixtureArtifacts(tempRoot)
        const installRoot = path.join(tempRoot, 'install')
        const staleAppVersion = createStaleAppVersion(installRoot, '0.0.1-smoke')
        const result = runInstallWorkflow(tempRoot, manifestPath)
        const versionRoot = path.join(installRoot, `app-${targetVersion}`)
        const installedAppExecutable = path.join(versionRoot, appExecutableName())
        const installedModuleFile = path.join(versionRoot, 'modules', moduleName, moduleFileName)

        if (result.state !== 'installed' || result.installed !== true) {
            throw new Error(`Expected install-workflow state=installed, got ${JSON.stringify(result)}`)
        }
        if (result.applyResult?.state !== 'applied') {
            throw new Error(`Expected install transaction state=applied, got ${JSON.stringify(result.applyResult)}`)
        }

        requireFile(installedAppExecutable)
        requireFile(installedModuleFile)
        const currentVersion = readCurrentVersion(installRoot)
        rejectPath(path.join(installRoot, 'app'))
        rejectPath(path.join(installRoot, 'modules'))
        rejectPath(staleAppVersion)
        if (result.applyResult?.cleanup?.state !== 'ok') {
            throw new Error(`Expected cleanup state=ok, got ${JSON.stringify(result.applyResult?.cleanup)}`)
        }

        const rollback = runRollback(result.prepareResult?.transactionDir)
        if (rollback.state !== 'rolled-back') {
            throw new Error(`Expected rollback state=rolled-back, got ${JSON.stringify(rollback)}`)
        }
        const appRollback = rollback.artifacts?.find(artifact => artifact.key === 'app')
        if (appRollback?.rollbackStatus !== 'removed') {
            throw new Error(`Expected app rollbackStatus=removed, got ${JSON.stringify(appRollback)}`)
        }
        if (rollback.currentVersionRestored?.state !== 'cleared') {
            throw new Error(`Expected rollback to clear current.json, got ${JSON.stringify(rollback.currentVersionRestored)}`)
        }
        rejectPath(installedAppExecutable)
        rejectPath(path.join(installRoot, 'current.json'))

        const startInstallRoot = path.join(tempRoot, 'start-install')
        const startResult = runBootstrapperStart(startInstallRoot, manifestPath)
        const startVersionRoot = path.join(startInstallRoot, `app-${targetVersion}`)
        const startAppExecutable = path.join(startVersionRoot, appExecutableName())
        const startModuleFile = path.join(startVersionRoot, 'modules', moduleName, moduleFileName)
        if (startResult.state !== 'launched' || startResult.launched !== true || typeof startResult.pid !== 'number') {
            throw new Error(`Expected bootstrapper start to launch app, got ${JSON.stringify(startResult)}`)
        }
        if (startResult.firstRunInstall?.state !== 'installed' || startResult.firstRunInstall.installed !== true) {
            throw new Error(`Expected bootstrapper start firstRunInstall=installed, got ${JSON.stringify(startResult.firstRunInstall)}`)
        }
        requireFile(startAppExecutable)
        requireFile(startModuleFile)
        readCurrentVersion(startInstallRoot)
        rejectPath(path.join(startInstallRoot, 'app'))
        rejectPath(path.join(startInstallRoot, 'modules'))

        const updateInstallRoot = path.join(tempRoot, 'update-install')
        const previousVersion = '98.0.0-smoke'
        const previousVersionRoot = path.join(updateInstallRoot, `app-${previousVersion}`)
        const previousAppExecutable = path.join(previousVersionRoot, appExecutableName())
        writeLaunchableAppExecutable(previousAppExecutable)
        writeCurrentVersion(updateInstallRoot, previousVersion)

        const updateApply = runUpdateApply(updateInstallRoot, manifestPath, previousVersion)
        const updateVersionRoot = path.join(updateInstallRoot, `app-${targetVersion}`)
        const updateAppExecutable = path.join(updateVersionRoot, appExecutableName())
        const updateModuleFile = path.join(updateVersionRoot, 'modules', moduleName, moduleFileName)
        if (updateApply.state !== 'applied' || updateApply.currentVersion !== targetVersion || updateApply.previousCurrentVersion !== previousVersion) {
            throw new Error(`Expected update apply to switch current from previous version, got ${JSON.stringify(updateApply)}`)
        }
        if (updateApply.cleanup?.state !== 'ok') {
            throw new Error(`Expected update cleanup state=ok, got ${JSON.stringify(updateApply.cleanup)}`)
        }
        requireFile(previousAppExecutable)
        requireFile(updateAppExecutable)
        requireFile(updateModuleFile)
        readCurrentVersion(updateInstallRoot, targetVersion)
        if (typeof updateApply.transactionDir !== 'string') {
            throw new Error(`Expected update transactionDir, got ${JSON.stringify(updateApply.transactionDir)}`)
        }

        const updateRollback = runRollbackFile(path.join(updateApply.transactionDir, 'transaction.json'))
        if (updateRollback.state !== 'rolled-back') {
            throw new Error(`Expected update rollback state=rolled-back, got ${JSON.stringify(updateRollback)}`)
        }
        if (updateRollback.currentVersionRestored?.state !== 'restored') {
            throw new Error(`Expected update rollback to restore previous current.json, got ${JSON.stringify(updateRollback.currentVersionRestored)}`)
        }
        rejectPath(updateAppExecutable)
        requireFile(previousAppExecutable)
        readCurrentVersion(updateInstallRoot, previousVersion)

        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    dist: dist(),
                    appArchive,
                    moduleArchive,
                    manifestPath,
                    currentVersion,
                    installedAppExecutable,
                    installedModuleFile,
                    installWorkflowState: result.state,
                    cleanupState: result.applyResult.cleanup.state,
                    transactionState: result.applyResult.state,
                    rollbackState: rollback.state,
                    rollbackCurrentVersionState: rollback.currentVersionRestored.state,
                    startState: startResult.state,
                    startFirstRunInstallState: startResult.firstRunInstall.state,
                    startTransactionAction: startResult.transactionAction,
                    updateApplyState: updateApply.state,
                    updatePreviousCurrentVersion: updateApply.previousCurrentVersion,
                    updateRollbackState: updateRollback.state,
                    updateRollbackCurrentVersionState: updateRollback.currentVersionRestored.state,
                },
                null,
                4,
            ),
        )
    } finally {
        if (process.env.PULSESYNC_KEEP_BOOTSTRAPPER_SMOKE !== '1') {
            fs.rmSync(tempRoot, { force: true, recursive: true })
        }
    }
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
