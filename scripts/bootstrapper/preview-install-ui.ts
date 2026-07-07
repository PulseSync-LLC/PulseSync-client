import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')
const moduleName = 'artifactWorker'
const moduleFileName = 'artifactWorker.cjs'
const targetVersion = '99.0.0-preview'

function dist(): string {
    return `${process.platform}-${process.arch}`
}

function appExecutableName(): string {
    if (process.platform === 'win32') {
        return 'PulseSync.exe'
    }
    if (process.platform === 'darwin') {
        return path.join('MacOS', 'PulseSync')
    }
    return 'pulsesync'
}

function sha256File(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function writeZip(sourceDir: string, archiveRoot: string, targetPath: string): void {
    const zip = new AdmZip()
    zip.addLocalFolder(sourceDir, archiveRoot)
    zip.writeZip(targetPath)
}

function artifactDescriptor(filePath: string): { sha256: string; size: number; url: string } {
    return {
        sha256: sha256File(filePath),
        size: fs.statSync(filePath).size,
        url: pathToFileURL(filePath).href,
    }
}

function createPreviewFixture(root: string): string {
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
    fs.writeFileSync(appExecutable, `PulseSync preview app executable for ${dist()}\n`, 'utf-8')
    fs.writeFileSync(moduleFile, `module.exports = { preview: true, dist: ${JSON.stringify(dist())} }\n`, 'utf-8')
    if (process.platform !== 'win32') {
        fs.chmodSync(appExecutable, 0o755)
    }

    writeZip(appSourceDir, 'app', appArchive)
    writeZip(moduleSourceDir, moduleName, moduleArchive)

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                channel: 'preview',
                clientVersion: targetVersion,
                rendererManifestUrl: 'https://app.pulsesync.dev/desktop/manifest.json',
                artifacts: {
                    [dist()]: {
                        app: artifactDescriptor(appArchive),
                        modules: {
                            [moduleName]: artifactDescriptor(moduleArchive),
                        },
                    },
                },
            },
            null,
            4,
        )}\n`,
        'utf-8',
    )

    return manifestPath
}

function main(): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-bootstrapper-ui-preview-'))
    const installRoot = path.join(root, 'install')
    const manifestPath = createPreviewFixture(root)
    const cargoManifest = path.join(projectRoot, 'packages', 'bootstrapper', 'Cargo.toml')

    console.log(`Preview install root: ${installRoot}`)
    console.log('Close the installer window when you finish looking at it.')

    const result = spawnSync(
        'cargo',
        [
            'run',
            '--quiet',
            '--manifest-path',
            cargoManifest,
            '--',
            'install-ui',
            '--keep-install-ui-open',
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
            stdio: 'inherit',
            windowsHide: false,
        },
    )

    if (result.error) {
        throw result.error
    }
    process.exitCode = result.status ?? 0
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
