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
        state?: unknown
    }
    installed?: unknown
    state?: unknown
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

function createFixtureArtifacts(root: string): { appArchive: string; manifestPath: string; moduleArchive: string } {
    const artifactsRoot = path.join(root, 'artifacts')
    const appSourceDir = path.join(root, 'fixtures', 'app')
    const moduleSourceDir = path.join(root, 'fixtures', moduleName)
    const appExecutable = path.join(appSourceDir, appExecutableName())
    const moduleFile = path.join(moduleSourceDir, moduleFileName)
    const appArchive = path.join(artifactsRoot, `pulsesync-app-payload-${targetVersion}-${dist()}.zip`)
    const moduleArchive = path.join(artifactsRoot, `pulsesync-native-modules-${moduleName}-${targetVersion}-${dist()}.zip`)
    const manifestPath = path.join(root, `desktop-update-${dist()}.json`)

    fs.mkdirSync(path.dirname(appExecutable), { recursive: true })
    fs.mkdirSync(moduleSourceDir, { recursive: true })
    fs.mkdirSync(artifactsRoot, { recursive: true })
    fs.writeFileSync(appExecutable, `PulseSync smoke app executable for ${dist()}\n`, 'utf-8')
    fs.writeFileSync(moduleFile, `module.exports = { smoke: true, dist: ${JSON.stringify(dist())} }\n`, 'utf-8')
    tryChmodExecutable(appExecutable)

    writeZip(appSourceDir, 'app', appArchive)
    writeZip(moduleSourceDir, moduleName, moduleArchive)

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

function requireFile(filePath: string): void {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Expected installed file: ${filePath}`)
    }
}

function main(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-bootstrapper-smoke-'))
    try {
        const { appArchive, manifestPath, moduleArchive } = createFixtureArtifacts(tempRoot)
        const result = runInstallWorkflow(tempRoot, manifestPath)
        const installRoot = path.join(tempRoot, 'install')
        const installedAppExecutable = path.join(installRoot, 'app', appExecutableName())
        const installedModuleFile = path.join(installRoot, 'modules', moduleName, moduleFileName)

        if (result.state !== 'installed' || result.installed !== true) {
            throw new Error(`Expected install-workflow state=installed, got ${JSON.stringify(result)}`)
        }
        if (result.applyResult?.state !== 'applied') {
            throw new Error(`Expected install transaction state=applied, got ${JSON.stringify(result.applyResult)}`)
        }

        requireFile(installedAppExecutable)
        requireFile(installedModuleFile)

        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    dist: dist(),
                    appArchive,
                    moduleArchive,
                    manifestPath,
                    installedAppExecutable,
                    installedModuleFile,
                    installWorkflowState: result.state,
                    transactionState: result.applyResult.state,
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
