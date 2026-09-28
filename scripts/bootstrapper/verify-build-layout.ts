import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findVersionedComponentContainer, readRuntimeComponentMetadata } from '../component-layout.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')

type TargetPlatform = 'darwin' | 'linux' | 'win32'

function readArgValue(args: string[], name: string): string | null {
    const index = args.indexOf(name)
    if (index === -1) return null
    return args[index + 1] ?? null
}

function getTargetPlatform(args: string[]): TargetPlatform {
    const platform = readArgValue(args, '--platform') ?? os.platform()
    if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
        return platform
    }

    throw new Error(`Unsupported platform for bootstrapper layout verification: ${platform}`)
}

function getTargetArch(args: string[], platform: TargetPlatform): string {
    if (platform === 'darwin') {
        return 'universal'
    }
    const explicitArch = readArgValue(args, '--arch')
    if (explicitArch) {
        return explicitArch
    }

    return os.arch()
}

function verifyMacUniversalBinary(binaryPath: string): void {
    execFileSync('/usr/bin/lipo', [binaryPath, '-verify_arch', 'x86_64', 'arm64'], { stdio: 'pipe' })
}

function getProductName(): string {
    const packageJsonPath = path.join(projectRoot, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { productName?: string }
    return packageJson.productName || 'PulseSync'
}

function runTsxScript(scriptPath: string, args: string[]): void {
    const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    execFileSync(process.execPath, [tsxCli, scriptPath, ...args], {
        cwd: projectRoot,
        stdio: 'inherit',
    })
}

function main(): void {
    const args = process.argv.slice(2)
    const platform = getTargetPlatform(args)
    const arch = getTargetArch(args, platform)
    const productName = getProductName()
    const outRoot = readArgValue(args, '--out-root') ?? 'out'
    const outDir = path.join(outRoot, `${productName}-${platform}-${arch}`)
    const payloadRoot = `${outDir}-bootstrapper`
    const setupRoot =
        platform === 'win32' ? `${outDir}-bootstrapper-setup` : platform === 'darwin' ? path.join(outDir, `${productName}.app`, 'Contents') : outDir

    if (platform === 'darwin') {
        const bundleRoot = path.join(outDir, `${productName}.app`)
        runTsxScript('scripts/bootstrapper/verify-package-layout.ts', ['--install-root', bundleRoot, '--platform', platform])
        runTsxScript('scripts/bootstrapper/verify-setup-layout.ts', ['--install-root', bundleRoot, '--platform', platform, '--arch', arch])
        const contentsDir = path.join(bundleRoot, 'Contents')
        const componentMetadata = readRuntimeComponentMetadata(projectRoot)
        const nativeContainer = findVersionedComponentContainer(path.join(contentsDir, 'modules'), componentMetadata.pulsesyncNative)
        verifyMacUniversalBinary(path.join(contentsDir, 'MacOS', productName))
        verifyMacUniversalBinary(path.join(contentsDir, 'Resources', 'bootstrapper', 'pulsesync-bootstrapper'))
        verifyMacUniversalBinary(path.join(nativeContainer, componentMetadata.pulsesyncNative.diskName, 'pulsesyncNative.node'))
        return
    }

    runTsxScript('scripts/bootstrapper/verify-package-layout.ts', ['--install-root', payloadRoot, '--platform', platform])
    runTsxScript('scripts/bootstrapper/verify-setup-layout.ts', ['--install-root', setupRoot, '--platform', platform, '--arch', arch])
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
