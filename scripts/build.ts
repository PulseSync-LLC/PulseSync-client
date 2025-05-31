import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { exec as _exec, execSync } from 'child_process'
import { performance } from 'perf_hooks'
import chalk from 'chalk'

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildInstaller = process.argv.includes('--installer') || process.argv.includes('-i')

enum LogLevel {
    INFO = 'INFO',
    SUCCESS = 'SUCCESS',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

function log(level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString()
    switch (level) {
        case LogLevel.INFO:
            console.log(`${chalk.gray(timestamp)} ${chalk.blue('[INFO] ')} ${message}`)
            break
        case LogLevel.SUCCESS:
            console.log(`${chalk.gray(timestamp)} ${chalk.green('[SUCCESS]')} ${message}`)
            break
        case LogLevel.WARN:
            console.log(`${chalk.gray(timestamp)} ${chalk.yellow('[WARN] ')} ${message}`)
            break
        case LogLevel.ERROR:
            console.error(`${chalk.gray(timestamp)} ${chalk.red('[ERROR]')} ${message}`)
            break
    }
}

function generateBuildInfo(): void {
    const pkgPath = path.resolve(__dirname, '../package.json')
    log(LogLevel.INFO, `Reading package.json from ${pkgPath}`)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version: string; buildInfo?: any; [key: string]: any }

    let branch = 'unknown'
    try {
        branch = execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim()
    } catch (err: any) {
        log(LogLevel.WARN, `Failed to get Git hash: ${err.message || err}`)
    }

    pkg.buildInfo = {
        VERSION: pkg.version,
        BRANCH: branch,
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), 'utf-8')
    log(LogLevel.SUCCESS, `Updated buildInfo.BRANCH → ${branch}`)
}

async function runCommandStep(name: string, command: string): Promise<void> {
    log(LogLevel.INFO, `Running step "${name}"...`)
    const start = performance.now()

    try {
        const { stdout, stderr } = await exec(command, { maxBuffer: 10 * 1024 * 1024 })
        const duration = ((performance.now() - start) / 1000).toFixed(2)

        if (debug) {
            if (stdout) process.stdout.write(stdout)
            if (stderr) process.stderr.write(stderr)
        }

        log(LogLevel.SUCCESS, `Step "${name}" completed in ${duration}s`)
    } catch (err: any) {
        const duration = ((performance.now() - start) / 1000).toFixed(2)
        log(LogLevel.ERROR, `Step "${name}" failed in ${duration}s`)
        log(LogLevel.ERROR, `Command: ${chalk.yellow(command)}`)
        if (err.stdout) process.stderr.write(chalk.yellow(err.stdout))
        if (err.stderr) process.stderr.write(chalk.yellow(err.stderr))
        process.exit(err.code ?? 1)
    }
}

async function main(): Promise<void> {
    log(LogLevel.INFO, `Platform: ${os.platform()}, Arch: ${os.arch()}`)
    log(LogLevel.INFO, `Working dir: ${process.cwd()}`)
    log(LogLevel.INFO, `Debug mode: ${debug ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Build Installer: ${buildInstaller ? 'ON' : 'OFF'}`)
    const outDir = path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)
    if(buildInstaller) {
        await runCommandStep('Build (electron-builder)', `electron-builder --pd "${outDir}"`)
        log(LogLevel.SUCCESS, 'All steps completed successfully')
        return
    }
    const t0 = performance.now()
    try {
        log(LogLevel.INFO, `Running step "Generate build info"...`)
        generateBuildInfo()
        const d0 = ((performance.now() - t0) / 1000).toFixed(2)
        log(LogLevel.SUCCESS, `Step "Generate build info" completed in ${d0}s`)
    } catch (err: any) {
        const d0 = ((performance.now() - t0) / 1000).toFixed(2)
        log(LogLevel.ERROR, `Step "Generate build info" failed in ${d0}s`)
        log(LogLevel.ERROR, err.message || err)
        process.exit(1)
    }

    await runCommandStep('Package (electron-forge)', 'electron-forge package')

    await runCommandStep('Build (electron-builder)', `electron-builder --pd "${outDir}"`)

    log(LogLevel.SUCCESS, 'All steps completed successfully')
}

main().catch(err => {
    log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
    process.exit(1)
})
