import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(moduleRoot, 'build', 'Release')
const macTargets = ['x86_64-apple-darwin', 'aarch64-apple-darwin']
const stampPath = resolve(releaseDir, '.build-inputs.sha256')
const rustFlags = [process.env.RUSTFLAGS, ...(process.platform === 'win32' ? ['-C link-arg=/Brepro'] : [])].filter(Boolean).join(' ')

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
        env: { ...process.env, RUSTFLAGS: rustFlags },
        stdio: 'inherit',
    })

    if (cargo.status !== 0) {
        process.exit(cargo.status ?? 1)
    }
}

const libraryName =
    process.platform === 'win32' ? 'pulsesync_native.dll' : process.platform === 'darwin' ? 'libpulsesync_native.dylib' : 'libpulsesync_native.so'
const destination = resolve(releaseDir, 'pulsesyncNative.node')

function collectInputFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = resolve(directory, entry.name)
        return entry.isDirectory() ? collectInputFiles(entryPath) : [entryPath]
    })
}

function buildInputsSha256(universal) {
    const rustc = spawnSync('rustc', ['--version', '--verbose'], { cwd: moduleRoot, encoding: 'utf8' })
    if (rustc.status !== 0) process.exit(rustc.status ?? 1)

    const hash = createHash('sha256')
    const inputs = ['Cargo.lock', 'Cargo.toml', 'build.rs', 'package.json', 'scripts/build.mjs']
        .map(relativePath => resolve(moduleRoot, relativePath))
        .concat(collectInputFiles(resolve(moduleRoot, 'src')))
        .sort()
    for (const input of inputs) {
        hash.update(input.slice(moduleRoot.length + 1).replaceAll('\\', '/'))
        hash.update('\0')
        hash.update(readFileSync(input))
        hash.update('\0')
    }
    hash.update(
        JSON.stringify({
            arch: process.arch,
            cargoBuildTarget: process.env.CARGO_BUILD_TARGET ?? '',
            platform: process.platform,
            rustFlags,
            rustc: rustc.stdout,
            universal,
        }),
    )
    return hash.digest('hex')
}

const universal = process.argv.includes('--universal')
const buildInputs = buildInputsSha256(universal)

mkdirSync(releaseDir, { recursive: true })

if (process.env.CI && existsSync(destination) && !existsSync(stampPath)) {
    writeFileSync(stampPath, `${buildInputs}\n`, 'utf8')
    console.log(`Adopted source-keyed CI cache -> ${destination}`)
    process.exit(0)
}

if (existsSync(destination) && existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === buildInputs) {
    console.log(`Reused cached native module -> ${destination}`)
    process.exit(0)
}

if (universal) {
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

writeFileSync(stampPath, `${buildInputs}\n`, 'utf8')
