import { exec, execFile, spawn, execSync } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fso, { promises as fsp } from 'original-fs'
import { asarBackup, musicPath } from '../../index'
import { app, dialog, shell } from 'electron'
import RendererEvents from '../../common/types/rendererEvents'
import axios from 'axios'
import * as plist from 'plist'
import { mainWindow } from '../modules/createWindow'
import logger from '../modules/logger'
import { getState } from '../modules/state'
import { t } from '../i18n'
import * as yaml from 'yaml'
import { YM_RELEASE_METADATA_URL } from '../constants/urls'
import asar from '@electron/asar'
import { nativeFileExists } from '../modules/nativeModules'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const State = getState()

export const normalizeModSaveDir = (customPath?: string): string | null => {
    if (!customPath) return null
    const trimmed = customPath.trim()
    if (!trimmed) return null
    const ext = path.extname(trimmed).toLowerCase()
    return ext === '.asar' ? path.dirname(trimmed) : trimmed
}

export const resolveModAsarPath = (musicPath: string, customPath?: string): string => {
    const baseDir = normalizeModSaveDir(customPath) || musicPath
    return path.join(baseDir, 'app.asar')
}

interface ProcessInfo {
    pid: number
}

export interface AppxPackage {
    Name: string
    PackageFullName: string
    PackageFamilyName: string
    Version: string
    [key: string]: any
}

const splitNonEmptyLines = (output: string): string[] =>
    output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

const parsePid = (value: string): number | null => {
    const pid = parseInt(value, 10)
    return Number.isNaN(pid) ? null : pid
}

const parseMacPgrep = (stdout: string): ProcessInfo[] =>
    splitNonEmptyLines(stdout)
        .map(line => parsePid(line))
        .filter((pid): pid is number => pid !== null)
        .map(pid => ({ pid }))

const parseLinuxPgrep = (stdout: string): ProcessInfo[] =>
    splitNonEmptyLines(stdout)
        .map(line => parsePid(line.split(' ')[0]))
        .filter((pid): pid is number => pid !== null)
        .map(pid => ({ pid }))

const escapeForBashSingleQuoted = (value: string): string => value.replace(/'/g, `'\\''`)

const parseWindowsTasklist = (stdout: string): ProcessInfo[] => {
    const processes = splitNonEmptyLines(stdout)
    const parsed: ProcessInfo[] = []
    processes.forEach(line => {
        const parts = line.split('","')
        if (parts.length <= 1) return
        const pidStr = parts[1].replace(/"/g, '').trim()
        const pid = parsePid(pidStr)
        if (pid !== null) parsed.push({ pid })
    })
    return parsed
}

const terminateProcess = (pid: number): void => {
    try {
        process.kill(pid)
        logger.main.info(`Yandex Music process ${pid} terminated.`)
    } catch (error) {
        logger.main.error(`Error terminating ${pid}:`, error)
    }
}

export async function getYandexMusicProcesses(): Promise<ProcessInfo[]> {
    if (isMac()) {
        try {
            const command = `pgrep -f "Яндекс Музыка"`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            return parseMacPgrep(stdout)
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes on Mac:', error)
            return []
        }
    } else if (isLinux()) {
        try {
            const command = `pgrep -fa "yandexmusic"`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            return parseLinuxPgrep(stdout)
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes on Linux:', error)
            return []
        }
    } else {
        try {
            const command = `tasklist /FI "IMAGENAME eq Яндекс Музыка.exe" /FO CSV /NH`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            return parseWindowsTasklist(stdout)
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes:', error)
            return []
        }
    }
}

export async function isYandexMusicRunning(): Promise<boolean> {
    return !!(await getYandexMusicProcesses())?.length
}

export async function closeYandexMusic(): Promise<void> {
    const procs = await getYandexMusicProcesses()
    if (!procs.length) {
        logger.main.info('Yandex Music is not running.')
        return
    }
    for (const { pid } of procs) {
        terminateProcess(pid)
    }
}

export async function launchYandexMusic() {
    await openExternalDetached('yandexmusic://')
}

export async function openExternalDetached(url: string) {
    let command: string
    let args: string[]

    if (process.platform === 'win32') {
        command = 'cmd.exe'
        args = ['/c', 'start', '', url]
    } else if (process.platform === 'darwin') {
        command = 'open'
        args = [url]
    } else {
        command = 'xdg-open'
        args = [url]
    }

    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
}

export async function getPathToYandexMusic(): Promise<string> {
    const platform = os.platform()
    const customSavePath = normalizeModSaveDir(State.get('settings.modSavePath') as string | undefined)
    if (platform === 'darwin') {
        return path.join('/Applications', 'Яндекс Музыка.app', 'Contents', 'Resources')
    } else if (platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'resources')
    } else if (platform === 'linux') {
        return !customSavePath ? path.join('/opt', 'Яндекс Музыка') : customSavePath
    }
    return ''
}

export function getYandexMusicAppDataPath(): string {
    const home = os.homedir()
    switch (os.platform()) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'YandexMusic')
        case 'win32':
            return path.join(process.env.APPDATA || '', 'YandexMusic')
        case 'linux': {
            const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
            return path.join(xdg, 'YandexMusic')
        }
        default:
            return ''
    }
}
export function getYandexMusicLogsPath(): string {
    const home = os.homedir()
    switch (os.platform()) {
        case 'darwin':
            return path.join(home, 'Library', 'Logs', 'YandexMusic')
        case 'win32':
            return path.join(process.env.APPDATA || '', 'YandexMusic', 'logs')
        case 'linux': {
            const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
            return path.join(xdg, 'YandexMusic', 'logs')
        }
        default:
            return ''
    }
}
export async function copyFile(target: string, dest: string): Promise<void> {
    try {
        await fsp.copyFile(target, dest)
    } catch (error: any) {
        if (process.platform === 'linux' && (error?.code === 'EACCES' || error?.code === 'EPERM')) {
            try {
                await execFileAsync('pkexec', ['cp', '--', target, dest])
                return
            } catch (pkexecError: any) {
                try {
                    const escapedTarget = escapeForBashSingleQuoted(target)
                    const escapedDest = escapeForBashSingleQuoted(dest)
                    await execFileAsync('pkexec', [
                        'bash',
                        '-c',
                        `cp -- '${escapedTarget}' '${escapedDest}'`,
                    ])
                    return
                } catch (pkexecShellError: any) {
                    logger.modManager.error('Elevated file copy via pkexec failed:', {
                        source: target,
                        destination: dest,
                        directCode: pkexecError?.code,
                        directMessage: pkexecError?.message,
                        directStderr: pkexecError?.stderr,
                        shellCode: pkexecShellError?.code,
                        shellMessage: pkexecShellError?.message,
                        shellStderr: pkexecShellError?.stderr,
                    })
                    throw pkexecShellError
                }
            }
        } else {
            logger.modManager.error('File copying failed:', error)
            throw error
        }
    }
}

export async function createDirIfNotExist(target: string): Promise<void> {
    if (!fso.existsSync(target)) {
        try {
            await fsp.mkdir(target, { recursive: true })
        } catch (error: any) {
            if (process.platform === 'linux' && (error?.code === 'EACCES' || error?.code === 'EPERM')) {
                try {
                    await execFileAsync('pkexec', ['mkdir', '-p', target])
                } catch {
                    const escapedTarget = escapeForBashSingleQuoted(target)
                    await execFileAsync('pkexec', [
                        'bash',
                        '-c',
                        `mkdir -p -- '${escapedTarget}'`,
                    ])
                }
            } else {
                logger.modManager.error('Directory creation failed:', error)
                throw error
            }
        }
    }
}

export function isMac() {
    return os.platform() === 'darwin'
}

export function isWindows() {
    return os.platform() === 'win32'
}

export function isLinux() {
    return os.platform() === 'linux'
}

export const formatSizeUnits = (bytes: number) => {
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB'
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(2) + ' MB'
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(2) + ' KB'
    return bytes + ' bytes'
}

export const getFolderSize = async (folderPath: string): Promise<number> => {
    let total = 0
    for (const file of await fso.promises.readdir(folderPath)) {
        const full = path.join(folderPath, file)
        const stat = await fso.promises.stat(full)
        total += stat.isDirectory() ? await getFolderSize(full) : stat.size
    }
    return total
}

export const formatJson = (data: any) => JSON.stringify(data, null, 4)

export const checkAsar = () => {
    if ((State.get('mod.installed') || State.get('mod.version')) && !fso.existsSync(asarBackup)) {
        State.delete('mod')
    } else if (fso.existsSync(asarBackup)) {
        State.set('mod.installed', true)
    }
}

export const checkMusic = () => {
    if (!fso.existsSync(musicPath) && !isLinux()) {
        dialog
            .showMessageBox(mainWindow, {
                type: 'info',
                title: t('main.appUtils.yandexNotInstalledTitle'),
                message: t('main.appUtils.yandexNotInstalledMessage'),
                buttons: [t('main.common.start'), t('main.common.cancel')],
                cancelId: 1,
            })
            .then(async result => {
                if (result.response === 0) await downloadYandexMusic()
                else app.quit()
            })
    }
}

export const downloadYandexMusic = async (type?: string) => {
    const sendDownloadFailure = (err: Error | string) => {
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
            success: false,
            error: typeof err === 'string' ? err : t('main.appUtils.executeFailed', { message: err.message }),
        })
    }

    const downloadUrl = await (async () => {
        if (isLinux()) {
            return await getLinuxInstallerUrl()
        }
        const yml = await axios.get('https://desktop.app.music.yandex.net/stable/latest.yml')
        const match = yml.data.match(/version:\s*([\d.]+)/)
        if (!match) throw new Error(t('main.appUtils.latestYmlVersionNotFound'))
        const version = match[1]
        const fileName = isMac() ? `Yandex_Music_universal_${version}.dmg` : `Yandex_Music_x64_${version}.exe`
        return `https://desktop.app.music.yandex.net/stable/${fileName}`
    })()
    const fileName = path.basename(downloadUrl)
    const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

    await fso.promises.mkdir(path.dirname(downloadPath), { recursive: true })
    const response = await axios.get(downloadUrl, { responseType: 'stream' })
    const total = parseInt(response.headers['content-length'], 10)
    let received = 0
    const writer = fso.createWriteStream(downloadPath)
    response.data.on('data', (chunk: Buffer) => {
        received += chunk.length
        const p = received / total
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_PROGRESS, { progress: Math.round(p * 100) })
        mainWindow.setProgressBar(p)
    })
    await new Promise<void>((res, rej) => {
        writer.on('finish', res)
        writer.on('error', rej)
        response.data.pipe(writer)
    })
    writer.close()
    mainWindow.setProgressBar(-1)
    fso.chmodSync(downloadPath, 0o755)

    if (isLinux()) {
        const openError = await shell.openPath(downloadPath)
        if (openError) {
            sendDownloadFailure(new Error(openError))
            return
        }
        try {
            fso.unlinkSync(downloadPath)
        } catch {}
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
            success: true,
            message: t('main.appUtils.fileOpenedSuccessfully'),
            type: type || 'update',
        })
        return
    }

    if (isMac()) {
        const mountPoint = `/Volumes/YandexMusic-${Date.now()}`
        const detach = async () => {
            try {
                await execFileAsync('hdiutil', ['detach', mountPoint])
            } catch {
                await new Promise(r => setTimeout(r, 500))
                try {
                    await execFileAsync('hdiutil', ['detach', '-force', mountPoint])
                } catch {}
            }
        }
        try {
            await execFileAsync('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, downloadPath])
            const entries = await fso.promises.readdir(mountPoint)
            const appName = entries.find(e => e.toLowerCase().endsWith('.app'))
            if (!appName) throw new Error(t('main.appUtils.dmgAppNotFound'))
            const appBundlePath = path.join(mountPoint, appName)

            let targetDir = '/Applications'
            let targetAppPath = path.join(targetDir, appName)

            try {
                await execFileAsync('cp', ['-R', appBundlePath, targetDir])
            } catch {
                targetDir = path.join(app.getPath('home'), 'Applications')
                await fsp.mkdir(targetDir, { recursive: true })
                targetAppPath = path.join(targetDir, appName)
                await execFileAsync('cp', ['-R', appBundlePath, targetDir])
            }

            await detach()
            try {
                fso.unlinkSync(downloadPath)
            } catch {}

            try {
                await execFileAsync('open', [targetAppPath])
            } catch (e) {
                sendDownloadFailure(e as Error)
                return
            }

            checkAsar()
            mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                success: true,
                message: t('main.appUtils.appInstalledAndLaunched'),
                type: type || 'update',
            })
        } catch (error) {
            try {
                await execFileAsync('hdiutil', ['detach', '-force', mountPoint])
            } catch {}
            sendDownloadFailure(error as Error)
        }
        return
    }

    setTimeout(() => {
        execFile(downloadPath, error => {
            if (error) {
                sendDownloadFailure(error)
                return
            }
            try {
                fso.unlinkSync(downloadPath)
            } catch {}
            checkAsar()
            mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                success: true,
                message: t('main.appUtils.fileExecutedSuccessfully'),
                type: type || 'update',
            })
        })
    }, 100)
}

export type PatchCallback = (progress: number, message: string) => void

export async function updateIntegrityHashInExe(exePath: string, newHash: string): Promise<void> {
    try {
        const rawBuf = await fsp.readFile(exePath)
        const buf = rawBuf as Buffer
        const marker = Buffer.from('"file":"resources\\\\app.asar"', 'utf8')
        const markerIdx = buf.indexOf(marker)
        if (markerIdx < 0) throw new Error(t('main.appUtils.rcdataJsonNotFound'))
        const startIdx = buf.lastIndexOf(Buffer.from('[', 'utf8'), markerIdx)
        if (startIdx < 0) throw new Error(t('main.appUtils.jsonArrayStartNotFound'))
        const endIdx = buf.indexOf(Buffer.from(']', 'utf8'), markerIdx + marker.length)
        if (endIdx < 0) throw new Error(t('main.appUtils.jsonArrayEndNotFound'))
        const jsonBuf = buf.subarray(startIdx, endIdx + 1)
        const arr = JSON.parse(jsonBuf.toString('utf8')) as Array<{ file: string; alg: string; value: string }>
        const entry = arr.find(e => e.file.replace(/\\\\/g, '\\').toLowerCase() === 'resources\\app.asar')
        if (!entry) throw new Error(t('main.appUtils.resourcesAsarNotFound'))
        entry.value = newHash
        const newJson = JSON.stringify(arr)
        if (Buffer.byteLength(newJson, 'utf8') !== jsonBuf.length) {
            throw new Error(t('main.appUtils.jsonLengthMismatch'))
        }
        Buffer.from(newJson, 'utf8').copy(buf, startIdx)
        await fsp.writeFile(exePath, buf)
    } catch (err) {
        logger.main.error(t('main.appUtils.updateIntegrityError'), err)
        await downloadYandexMusic('reinstall')
        throw err
    }
}

export class AsarPatcher {
    private readonly appBundlePath: string
    private readonly resourcesDir: string
    private readonly infoPlistPath: string
    private readonly asarRelPath = 'app.asar'
    private readonly asarPath: string
    private readonly tmpEntitlements: string

    constructor(appBundlePath: string) {
        this.appBundlePath = appBundlePath
        this.resourcesDir = path.join(appBundlePath, 'Contents', 'Resources')
        this.infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist')
        this.asarPath = path.join(this.resourcesDir, this.asarRelPath)
        this.tmpEntitlements = path.join(os.tmpdir(), 'extracted_entitlements.xml')
    }

    private get isMacPlatform(): boolean {
        return os.platform() === 'darwin'
    }

    private calcAsarHeaderHash(archivePath: string): string {
        const headerString = asar.getRawHeader(archivePath).headerString
        return crypto.createHash('sha256').update(headerString).digest('hex')
    }

    public async patch(callback?: PatchCallback): Promise<boolean> {
        if (isLinux()) return true
        if (isWindows()) {
            const localAppData = process.env.LOCALAPPDATA
            if (!localAppData) {
                callback?.(-1, t('main.appUtils.localAppDataMissing'))
                return false
            }
            const exePath = path.join(localAppData, 'Programs', 'YandexMusic', 'Яндекс Музыка.exe')
            try {
                callback?.(0, t('main.appUtils.readingExe'))
                const asarPathFull = path.join(localAppData, 'Programs', 'YandexMusic', 'resources', 'app.asar')
                const newHash = this.calcAsarHeaderHash(asarPathFull)
                await updateIntegrityHashInExe(exePath, newHash)
                callback?.(1, t('main.appUtils.windowsPatchSuccess'))
                return true
            } catch (err) {
                callback?.(0, t('main.appUtils.windowsPatchError', { message: (err as Error).message }))
                return false
            }
        }

        if (!this.isMacPlatform) {
            callback?.(0, t('main.appUtils.patchSupportedPlatforms'))
            return false
        }

        try {
            await fsp.access(this.asarPath, fso.constants.W_OK)
        } catch (err) {
            logger.main.error(t('main.appUtils.noWriteAccess'), err)
            await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: t('main.appUtils.permissionsRequiredTitle'),
                message: t('main.appUtils.permissionsRequiredMessage'),
                buttons: [t('main.common.openSettings'), t('main.common.cancel')],
                cancelId: 1,
            })
            execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"')
            return false
        }

        const sipEnabled = (() => {
            try {
                const status = execSync('csrutil status', { encoding: 'utf8' })
                return status.includes('Filesystem Protections: enabled')
            } catch {
                return true
            }
        })()

        if (sipEnabled) {
            callback?.(0, t('main.appUtils.sipEnabled'))
            return false
        }

        try {
            const raw = await fsp.readFile(this.infoPlistPath, 'utf8')
            const data = plist.parse(raw) as any

            if (data.ElectronAsarIntegrity && data.ElectronAsarIntegrity['Resources/app.asar']) {
                callback?.(0.2, t('main.appUtils.updatingInfoPlistHash'))
                data.ElectronAsarIntegrity['Resources/app.asar'].hash = this.calcAsarHeaderHash(this.asarPath)
                await fsp.writeFile(this.infoPlistPath, plist.build(data), 'utf8')
                callback?.(0.5, t('main.appUtils.hashUpdated'))
            }

            callback?.(0.6, t('main.appUtils.dumpingEntitlements'))
            execSync(`codesign -d --entitlements :- '${this.appBundlePath}' > '${this.tmpEntitlements}'`, { stdio: 'ignore' })

            callback?.(0.7, t('main.appUtils.reSigningApp'))
            execSync(`codesign --force --entitlements '${this.tmpEntitlements}' --sign - '${this.appBundlePath}'`, { stdio: 'ignore' })
            await fsp.unlink(this.tmpEntitlements)

            callback?.(1, t('main.appUtils.macPatchSuccess'))
            return true
        } catch (err) {
            try {
                await fsp.unlink(this.tmpEntitlements)
            } catch {}
            callback?.(0, t('main.appUtils.macPatchError', { message: (err as Error).message }))
            return false
        }
    }
}

export async function clearDirectory(directoryPath: string): Promise<void> {
    try {
        await fsp.access(directoryPath)
    } catch {
        return
    }
    for (const entry of await fsp.readdir(directoryPath)) {
        const full = path.join(directoryPath, entry)
        const stat = await fsp.stat(full)
        if (stat.isDirectory()) {
            await clearDirectory(full)
            await fsp.rmdir(full)
        } else {
            await fsp.unlink(full)
        }
    }
}

const runPowerShell = async (script: string, args: string[] = []): Promise<string> => {
    const psArgs = ['-NoProfile', '-NonInteractive', '-Command', script, ...args]
    const { stdout } = (await execFileAsync('powershell.exe', psArgs, {
        windowsHide: true,
        timeout: 10000,
    })) as { stdout: string }
    return stdout ?? ''
}

export async function findAppByName(namePart: string): Promise<AppxPackage | null> {
    const psScript = [
        '& {',
        'param([string]$namePart)',
        '$pkg = Get-AppxPackage 2>$null | Where-Object { $_.Name -like ("*" + $namePart + "*") } | Select-Object -First 1;',
        'if ($pkg) { $pkg | ConvertTo-Json -Depth 4 -Compress }',
        '}',
    ].join(' ')

    const out = (await runPowerShell(psScript, [namePart])).trim()
    if (!out) return null
    try {
        return JSON.parse(out)
    } catch (error) {
        throw new Error(`JSON parse error: ${(error as Error).message}`)
    }
}

export async function uninstallApp(packageFullName: string): Promise<void> {
    const psScript = ['& {', 'param([string]$packageFullName)', 'Remove-AppxPackage -Package $packageFullName', '}'].join(' ')
    await runPowerShell(psScript, [packageFullName])
}

export async function getYandexMusicMetadata() {
    return yaml.parse(await (await fetch(YM_RELEASE_METADATA_URL)).text())
}

export async function getLinuxInstallerUrl(): Promise<string> {
    const yml = await axios.get(YM_RELEASE_METADATA_URL)
    const match = String(yml.data).match(/version:\s*([\d.]+)/)
    if (!match) throw new Error(t('main.appUtils.latestYmlVersionNotFound'))
    const version = match[1]
    return `https://desktop.app.music.yandex.net/stable/Yandex_Music_amd64_${version}.deb`
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function stripBomAndControls(s: string): string {
    return s
        .replace(/^\uFEFF/, '')
        .replace(/\u0000/g, '')
        .trim()
}

function tryParseJsonLoose(s: string): any {
    const cleaned = stripBomAndControls(s)
    try {
        return JSON.parse(cleaned)
    } catch {}
    const noLineComments = cleaned.replace(/^\s*\/\/.*$/gm, '')
    const noBlockComments = noLineComments.replace(/\/\*[^]*?\*\//g, '')
    const noTrailingCommas = noBlockComments.replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(noTrailingCommas)
}

async function extractJsonFromAsarWithRetry(asarPath: string, innerPath: string, opts?: { attempts?: number; delayMs?: number }) {
    const attempts = opts?.attempts ?? 40
    const delayMs = opts?.delayMs ?? 120
    let lastErr: any = null
    for (let i = 0; i < attempts; i++) {
        try {
            const buff = asar.extractFile(asarPath, innerPath)
            if (!buff || buff.length === 0) throw new Error('empty buffer')
            const rawText = buff.toString('utf-8')
            const obj = tryParseJsonLoose(rawText)
            return obj
        } catch (e) {
            lastErr = e
            await sleep(delayMs)
        }
    }
    throw lastErr ?? new Error('failed to extract json from asar')
}

export async function getInstalledYmMetadata() {
    try {
        const ymDir = await getPathToYandexMusic()
        if (!ymDir) {
            logger.modManager.warn('getPathToYandexMusic returned empty path')
            return null
        }
        const versionFilePath = path.join(ymDir, 'version.bin')
        if (!nativeFileExists(versionFilePath)) {
            logger.modManager.warn('version file not found in Yandex Music directory')
            return null
        }
        const version = (await fso.promises.readFile(versionFilePath, 'utf8')).trim()
        return { version }
    } catch (error) {
        logger.modManager.error('Error reading version file:', error)
        return null
    }
}
