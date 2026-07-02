import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const bootstrapperRoot = path.join(projectRoot, 'packages', 'bootstrapper')
const bootstrapperDistDir = path.join(bootstrapperRoot, 'dist')
const bootstrapperEntryFile = 'cli.js'
const packagedBootstrapperDirName = 'bootstrapper'

type CopyOptions = {
    build?: boolean
    resourcesDir: string
}

function resolveInsideProject(targetPath: string): string {
    const resolvedPath = path.resolve(projectRoot, targetPath)
    const relativePath = path.relative(projectRoot, resolvedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Path must stay inside the project: ${targetPath}`)
    }
    return resolvedPath
}

async function runTscBuild(): Promise<void> {
    const tscPath = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
    await execFileAsync(process.execPath, [tscPath, '-p', path.join(bootstrapperRoot, 'tsconfig.build.json')], {
        cwd: projectRoot,
        windowsHide: true,
    })
}

function writeRuntimePackageJson(): void {
    const runtimePackageJson = {
        name: '@pulsesync/bootstrapper-runtime',
        private: true,
        type: 'module',
        bin: {
            'pulsesync-bootstrapper': `./${bootstrapperEntryFile}`,
        },
    }

    fs.writeFileSync(path.join(bootstrapperDistDir, 'package.json'), `${JSON.stringify(runtimePackageJson, null, 4)}\n`, 'utf8')
}

export async function buildBootstrapperSidecar(): Promise<string> {
    fs.rmSync(bootstrapperDistDir, { force: true, recursive: true })
    await runTscBuild()
    writeRuntimePackageJson()
    return bootstrapperDistDir
}

export async function copyBootstrapperSidecarToResources(resourcesDir: string, options: { build?: boolean } = {}): Promise<string> {
    if (options.build !== false) {
        await buildBootstrapperSidecar()
    }

    const resolvedResourcesDir = resolveInsideProject(resourcesDir)
    const targetDir = path.join(resolvedResourcesDir, packagedBootstrapperDirName)
    fs.rmSync(targetDir, { force: true, recursive: true })
    fs.mkdirSync(path.dirname(targetDir), { recursive: true })
    fs.cpSync(bootstrapperDistDir, targetDir, { recursive: true })
    return targetDir
}

function readArgValue(args: string[], name: string): string | null {
    const index = args.indexOf(name)
    if (index === -1) {
        return null
    }

    return args[index + 1] ?? null
}

function parseCopyOptions(args: string[]): CopyOptions {
    const resourcesDir = readArgValue(args, '--resources-dir')
    if (!resourcesDir) {
        throw new Error('Usage: tsx scripts/build-bootstrapper.ts copy --resources-dir <path> [--no-build]')
    }

    return {
        resourcesDir,
        build: !args.includes('--no-build'),
    }
}

async function main(): Promise<void> {
    const [command = 'build', ...args] = process.argv.slice(2)

    if (command === 'build') {
        const outputDir = await buildBootstrapperSidecar()
        console.log(`PulseSync bootstrapper built: ${outputDir}`)
        return
    }

    if (command === 'copy') {
        const options = parseCopyOptions(args)
        const outputDir = await copyBootstrapperSidecarToResources(options.resourcesDir, { build: options.build })
        console.log(`PulseSync bootstrapper copied: ${outputDir}`)
        return
    }

    throw new Error(`Unknown bootstrapper build command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
