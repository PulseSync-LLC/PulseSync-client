import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(moduleRoot, 'build', 'Release')
const macTargets = ['x86_64-apple-darwin', 'aarch64-apple-darwin']

if (process.argv.includes('--clean')) {
    rmSync(resolve(moduleRoot, 'build'), { recursive: true, force: true })
    rmSync(resolve(moduleRoot, 'target'), { recursive: true, force: true })
    process.exit(0)
}

function build(target) {
    const args = ['build', '--release', '--locked']
    if (target) args.push('--target', target)
    const cargo = spawnSync('cargo', args, {
        cwd: moduleRoot,
        stdio: 'inherit',
    })

    if (cargo.status !== 0) {
        process.exit(cargo.status ?? 1)
    }
}

const libraryName =
    process.platform === 'win32' ? 'pulsesync_native.dll' : process.platform === 'darwin' ? 'libpulsesync_native.dylib' : 'libpulsesync_native.so'
const destination = resolve(releaseDir, 'pulsesyncNative.node')

mkdirSync(releaseDir, { recursive: true })

if (process.argv.includes('--universal')) {
    if (process.platform !== 'darwin') {
        throw new Error('Universal pulsesyncNative builds are only supported on macOS')
    }
    const slices = macTargets.map(target => {
        build(target)
        return resolve(moduleRoot, 'target', target, 'release', libraryName)
    })
    rmSync(destination, { force: true })
    const lipo = spawnSync('/usr/bin/lipo', ['-create', ...slices, '-output', destination], {
        cwd: moduleRoot,
        stdio: 'inherit',
    })
    if (lipo.status !== 0) {
        process.exit(lipo.status ?? 1)
    }
    const verify = spawnSync('/usr/bin/lipo', [destination, '-verify_arch', 'x86_64', 'arm64'], {
        cwd: moduleRoot,
        stdio: 'inherit',
    })
    if (verify.status !== 0) {
        process.exit(verify.status ?? 1)
    }
    console.log(`Created universal native module -> ${destination}`)
} else {
    build()
    const source = resolve(moduleRoot, 'target', 'release', libraryName)
    copyFileSync(source, destination)
    console.log(`Copied ${source} -> ${destination}`)
}
