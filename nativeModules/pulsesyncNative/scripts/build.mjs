import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(moduleRoot, 'build', 'Release')

if (process.argv.includes('--clean')) {
    rmSync(resolve(moduleRoot, 'build'), { recursive: true, force: true })
    rmSync(resolve(moduleRoot, 'target'), { recursive: true, force: true })
    process.exit(0)
}

const cargo = spawnSync('cargo', ['build', '--release', '--locked'], {
    cwd: moduleRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
})

if (cargo.status !== 0) {
    process.exit(cargo.status ?? 1)
}

const libraryName =
    process.platform === 'win32' ? 'pulsesync_native.dll' : process.platform === 'darwin' ? 'libpulsesync_native.dylib' : 'libpulsesync_native.so'
const source = resolve(moduleRoot, 'target', 'release', libraryName)
const destination = resolve(releaseDir, 'pulsesyncNative.node')

mkdirSync(releaseDir, { recursive: true })
copyFileSync(source, destination)
console.log(`Copied ${source} -> ${destination}`)
