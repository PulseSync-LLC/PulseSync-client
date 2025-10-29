import { exec, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fs from 'original-fs'
import { asarBackup, musicPath } from '../../index'
import { app, BrowserWindow, dialog } from 'electron'
import RendererEvents from '../../common/types/rendererEvents'
import axios from 'axios'
import { execSync } from 'child_process'
import * as plist from 'plist'
import asar from '@electron/asar'
import { promises as fsp } from 'original-fs'
import { mainWindow } from '../modules/createWindow'
import logger from '../modules/logger'
import { getState } from '../modules/state'
import config from '../../renderer/api/web_config'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const spawnAsync = promisify(spawn)

const State = getState()

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

export async function getYandexMusicProcesses(): Promise<ProcessInfo[]> {
    if (isMac()) {
        try {
            const command = `pgrep -f "Яндекс Музыка"`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            const processes = stdout.split('\n').filter(line => line.trim() !== '')
            return processes.map(pid => ({ pid: parseInt(pid, 10) })).filter(proc => !isNaN(proc.pid))
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes on Mac:', error)
            return []
        }
    } else if (isLinux()) {
        try {
            const command = `pgrep -fa "yandexmusic"`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            const processes = stdout.split('\n').filter(line => line.trim() !== '')
            return processes
                .map(line => {
                    const parts = line.split(' ')
                    const pid = parseInt(parts[0], 10)
                    return { pid }
                })
                .filter(proc => !isNaN(proc.pid))
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes on Linux:', error)
            return []
        }
    } else {
        try {
            const command = `tasklist /FI "IMAGENAME eq Яндекс Музыка.exe" /FO CSV /NH`
            const { stdout } = (await execAsync(command, { encoding: 'utf8' as BufferEncoding })) as { stdout: string }
            const processes = stdout.split('\n').filter(line => line.trim() !== '')
            const yandexProcesses: ProcessInfo[] = []
            processes.forEach(line => {
                const parts = line.split('","')
                if (parts.length > 1) {
                    const pidStr = parts[1].replace(/"/g, '').trim()
                    const pid = parseInt(pidStr, 10)
                    if (!isNaN(pid)) {
                        yandexProcesses.push({ pid })
                    }
                }
            })
            return yandexProcesses
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes:', error)
            return []
        }
    }
}

export async function isYandexMusicRunning(): Promise<ProcessInfo[]> {
    return await getYandexMusicProcesses()
}

export async function closeYandexMusic(): Promise<void> {
    const procs = await isYandexMusicRunning()
    if (!procs.length) {
        logger.main.info('Yandex Music is not running.')
        return
    }
    for (const { pid } of procs) {
        try {
            process.kill(pid)
            logger.main.info(`Yandex Music process ${pid} terminated.`)
        } catch (error) {
            logger.main.error(`Error terminating ${pid}:`, error)
        }
    }
}

export async function launchYandexMusic() {
    await openExternalDetached('yandexmusic://')
}

export async function openExternalDetached(url: string) {
    let command, args

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

    const child = (await spawnAsync(command, args, { detached: true, stdio: 'ignore' })) as unknown as import('child_process').ChildProcess
    child.unref()
}

export async function checkYandexMusicLinuxInstall(): Promise<boolean> {
    const version = await getYandexMusicVersion()
    if (!version) {
        logger.main.error('Yandex Music version not found')
        return false
    }
    return true
}

export async function getPathToYandexMusic(): Promise<string> {
    const platform = os.platform()
    const customSavePath = State.get('settings.modSavePath')
    if (platform === 'darwin') {
        return path.join('/Applications', 'Яндекс Музыка.app', 'Contents', 'Resources')
    } else if (platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'resources')
    } else if (platform === 'linux') {
        return !customSavePath ? path.join('/opt', 'Яндекс Музыка') : path.join(customSavePath)
    }
}

export function getYandexMusicAppDataPath(): string {
    const home = os.homedir()
    switch (os.platform()) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'YandexMusic')
        case 'win32':
            return path.join(process.env.APPDATA || '', 'YandexMusic')
        case 'linux':
            const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
            return path.join(xdg, 'YandexMusic')
        default:
            return ''
    }
}

export async function copyFile(target: string, dest: string): Promise<void> {
    try {
        await fs.promises.copyFile(target, dest)
    } catch (error: any) {
        if (process.platform === 'linux' && error && error.code === 'EACCES') {
            await execFileAsync('pkexec', ['cp', target, dest])
        } else {
            logger.modManager.error('File copying failed:', error)
            throw error
        }
    }
}

export async function createDirIfNotExist(target: string): Promise<void> {
    if (!fs.existsSync(target)) {
        try {
            await fsp.mkdir(target, { recursive: true })
        } catch (error: any) {
            if (process.platform === 'linux' && error && error.code === 'EACCES') {
                await execFileAsync('pkexec', ['mkdir', '-p', target])
            } else {
                logger.modManager.error('Directory creation failed:', error)
                throw error
            }
        }
    }
}

export const isMac = () => os.platform() === 'darwin'
export const isWindows = () => os.platform() === 'win32'
export const isLinux = () => os.platform() === 'linux'

export const formatSizeUnits = (bytes: number) => {
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB'
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(2) + ' MB'
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(2) + ' KB'
    return bytes + ' bytes'
}

export const getFolderSize = async (folderPath: string): Promise<number> => {
    let total = 0
    for (const file of await fs.promises.readdir(folderPath)) {
        const full = path.join(folderPath, file)
        const stat = await fs.promises.stat(full)
        total += stat.isDirectory() ? await getFolderSize(full) : stat.size
    }
    return total
}

export const formatJson = (data: any) => JSON.stringify(data, null, 4)

export const checkAsar = () => {
    if ((State.get('mod.installed') || State.get('mod.version')) && !fs.existsSync(asarBackup)) {
        State.delete('mod')
    } else if (fs.existsSync(asarBackup)) {
        State.set('mod.installed', true)
    }
}

export const checkMusic = () => {
    if (!fs.existsSync(musicPath) && !isLinux()) {
        dialog
            .showMessageBox(mainWindow, {
                type: 'info',
                title: 'Яндекс Музыка не установлена',
                message: 'Приложение Яндекс Музыка не найдено. Начать установку?',
                buttons: ['Начать', 'Отменить'],
                cancelId: 1,
            })
            .then(async result => {
                if (result.response === 0) await downloadYandexMusic()
                else app.quit()
            })
    }
}

export const downloadYandexMusic = async (type?: string) => {
    const yml = await axios.get('https://music-desktop-application.s3.yandex.net/stable/latest.yml')
    const match = yml.data.match(/version:\s*([\d.]+)/)
    if (!match) throw new Error('Версия не найдена в latest.yml')
    const version = match[1]

    const fileName = isMac() ? `Yandex_Music_universal_${version}.dmg` : `Yandex_Music_x64_${version}.exe`
    const downloadUrl = `https://music-desktop-application.s3.yandex.net/stable/${fileName}`
    const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

    await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true })
    const response = await axios.get(downloadUrl, { responseType: 'stream' })
    const total = parseInt(response.headers['content-length'], 10)
    let received = 0
    const writer = fs.createWriteStream(downloadPath)
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
    fs.chmodSync(downloadPath, 0o755)

    const execFileAsync = (file: string, args: string[] = []) =>
        new Promise<void>((resolve, reject) => {
            execFile(file, args, error => {
                if (error) return reject(error)
                resolve()
            })
        })

    const sendFailure = (err: Error | string) => {
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
            success: false,
            error: typeof err === 'string' ? err : `Failed to execute: ${err.message}`,
        })
    }

    if (isMac()) {
        const mountPoint = `/Volumes/YandexMusic-${Date.now()}`
        try {
            await execFileAsync('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, downloadPath])
            const entries = await fs.promises.readdir(mountPoint)
            const appName = entries.find(e => e.toLowerCase().endsWith('.app'))
            if (!appName) throw new Error('В DMG не найден .app пакет')
            const appBundlePath = path.join(mountPoint, appName)

            let targetDir = '/Applications'
            let targetAppPath = path.join(targetDir, appName)

            try {
                await execFileAsync('cp', ['-R', appBundlePath, targetDir])
            } catch {
                targetDir = path.join(app.getPath('home'), 'Applications')
                await fs.promises.mkdir(targetDir, { recursive: true })
                targetAppPath = path.join(targetDir, appName)
                await execFileAsync('cp', ['-R', appBundlePath, targetDir])
            }

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

            await detach()
            try {
                fs.unlinkSync(downloadPath)
            } catch {}

            try {
                await execFileAsync('open', [targetAppPath])
            } catch (e) {
                sendFailure(e as Error)
                return
            }

            checkAsar()
            mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                success: true,
                message: 'Приложение установлено и запущено.',
                type: type || 'update',
            })
        } catch (error) {
            try {
                await execFileAsync('hdiutil', ['detach', '-force', mountPoint])
            } catch {}
            sendFailure(error as Error)
        }
        return
    }

    setTimeout(() => {
        execFile(downloadPath, error => {
            if (error) {
                mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                    success: false,
                    error: `Failed to execute: ${error.message}`,
                })
                return
            }
            try {
                fs.unlinkSync(downloadPath)
            } catch {}
            checkAsar()
            mainWindow.webContents.send(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                success: true,
                message: 'File executed successfully.',
                type: type || 'update',
            })
        })
    }, 100)
}

export type PatchCallback = (progress: number, message: string) => void

export async function updateIntegrityHashInExe(exePath: string, newHash: string): Promise<void> {
    try {
        const buf = await fsp.readFile(exePath)
        const marker = Buffer.from('"file":"resources\\\\app.asar"', 'utf8')
        const markerIdx = buf.indexOf(marker)
        if (markerIdx < 0) throw new Error('RCDATA JSON запись не найдена')
        const startIdx = buf.lastIndexOf(Buffer.from('[', 'utf8'), markerIdx)
        if (startIdx < 0) throw new Error('Не найдено начало JSON-массива')
        const endIdx = buf.indexOf(Buffer.from(']', 'utf8'), markerIdx + marker.length)
        if (endIdx < 0) throw new Error('Не найден конец JSON-массива')
        const jsonBuf = buf.subarray(startIdx, endIdx + 1)
        const arr = JSON.parse(jsonBuf.toString('utf8')) as Array<{ file: string; alg: string; value: string }>
        const entry = arr.find(e => e.file.replace(/\\\\/g, '\\').toLowerCase() === 'resources\\app.asar')
        if (!entry) throw new Error('Запись resources\\app.asar не найдена')
        entry.value = newHash
        const newJson = JSON.stringify(arr)
        if (Buffer.byteLength(newJson, 'utf8') !== jsonBuf.length) {
            throw new Error('Новая JSON длина не совпадает со старой')
        }
        Buffer.from(newJson, 'utf8').copy(buf, startIdx)
        await fsp.writeFile(exePath, buf)
    } catch (err) {
        logger.main.error('Ошибка в updateIntegrityHashInExe:', err)
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
        if (isWindows()) {
            const localAppData = process.env.LOCALAPPDATA
            if (!localAppData) {
                callback?.(-1, 'LOCALAPPDATA не задан')
                return false
            }
            const exePath = path.join(localAppData, 'Programs', 'YandexMusic', 'Яндекс Музыка.exe')
            try {
                callback?.(0, 'Чтение EXE...')
                const asarPathFull = path.join(localAppData, 'Programs', 'YandexMusic', 'resources', 'app.asar')
                const newHash = this.calcAsarHeaderHash(asarPathFull)
                await updateIntegrityHashInExe(exePath, newHash)
                callback?.(1, 'Патч Windows выполнен успешно')
                return true
            } catch (err) {
                callback?.(0, `Ошибка Windows-патча: ${(err as Error).message}`)
                return false
            }
        }

        if (!this.isMacPlatform) {
            callback?.(0, 'Патч доступен только на Windows и macOS')
            return false
        }

        try {
            await fsp.access(this.asarPath, fs.constants.W_OK)
        } catch (err) {
            logger.main.error('Нет прав на запись app.asar', err)
            await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Требуются права',
                message: 'Предоставьте доступ к записи для патча ASAR и повторите.',
                buttons: ['Открыть настройки', 'Отмена'],
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
            callback?.(0, 'SIP включён — отключите его и повторите')
            return false
        }

        try {
            const raw = await fsp.readFile(this.infoPlistPath, 'utf8')
            const data = plist.parse(raw) as any

            if (data.ElectronAsarIntegrity && data.ElectronAsarIntegrity['Resources/app.asar']) {
                callback?.(0.2, 'Обновляем хеш в Info.plist...')
                data.ElectronAsarIntegrity['Resources/app.asar'].hash = this.calcAsarHeaderHash(this.asarPath)
                await fsp.writeFile(this.infoPlistPath, plist.build(data), 'utf8')
                callback?.(0.5, 'Хеш обновлён')
            }

            callback?.(0.6, 'Дампим entitlements…')
            execSync(`codesign -d --entitlements :- '${this.appBundlePath}' > '${this.tmpEntitlements}'`, { stdio: 'ignore' })

            callback?.(0.7, 'Переподписываем приложение…')
            execSync(`codesign --force --entitlements '${this.tmpEntitlements}' --sign - '${this.appBundlePath}'`, { stdio: 'ignore' })
            await fsp.unlink(this.tmpEntitlements)

            callback?.(1, 'Патч macOS выполнен успешно')
            return true
        } catch (err) {
            try {
                await fsp.unlink(this.tmpEntitlements)
            } catch {}
            callback?.(0, `Ошибка macOS-патча: ${(err as Error).message}`)
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

export function findAppByName(namePart: string): Promise<AppxPackage | null> {
    const psScript = `
    $pkg = Get-AppxPackage 2>$null |
      Where-Object { $_.Name -like '*${namePart}*' } |
      Select-Object -First 1;
    if ($pkg) { $pkg | ConvertTo-Json -Depth 4 -Compress }
  `
    const cmd = `powershell.exe -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, ' ')}"`

    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
            if (error && stderr.trim()) return reject(new Error(stderr.trim()))
            const out = stdout.trim()
            if (!out) return resolve(null)
            try {
                resolve(JSON.parse(out))
            } catch (e) {
                reject(new Error(`JSON parse error: ${(e as Error).message}`))
            }
        })
    })
}

export function uninstallApp(packageFullName: string): Promise<void> {
    const cmd = `powershell.exe -NoProfile -NonInteractive -Command "Remove-AppxPackage -Package '${packageFullName}'"`
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) => {
            if (error) return reject(new Error(stderr.trim() || error.message))
            resolve()
        })
    })
}

export const getYandexMusicVersion = async (): Promise<string> => {
    const safeParseJson = (text: string) => {
        const cleaned = text.replace(/^\uFEFF/, '').trim()
        return JSON.parse(cleaned)
    }

    const tryReadVersionFromAsar = (asarPath: string): string | null => {
        const candidates = ['package.json', 'app/package.json']
        for (const candidate of candidates) {
            try {
                const buf = asar.extractFile(asarPath, candidate)
                if (!buf || buf.length === 0) {
                    logger.modManager.warn(`Пустой ${candidate} в app.asar`)
                    continue
                }
                const pkg = safeParseJson(buf.toString('utf8'))
                if (pkg && pkg.version) return String(pkg.version)
                logger.modManager.warn(`Поле version не найдено в ${candidate} внутри app.asar`)
            } catch (e) {
                const msg = (e as Error).message
                if (msg && /no such file/i.test(msg)) {
                    logger.modManager.warn(`${candidate} отсутствует в app.asar`)
                } else if (msg && /unexpected token/i.test(msg)) {
                    logger.modManager.warn(`Некорректный JSON в ${candidate} внутри app.asar: ${msg}`)
                } else {
                    logger.modManager.warn(`Не удалось прочитать ${candidate} из app.asar: ${msg}`)
                }
            }
        }
        return null
    }

    try {
        const resourcesDir = await getPathToYandexMusic()
        const asarPath = path.join(resourcesDir, 'app.asar')

        if (!fs.existsSync(asarPath)) {
            logger.modManager.error(`app.asar не найден по пути: ${asarPath}`)
            return '0.0.0'
        }

        const ver = tryReadVersionFromAsar(asarPath)
        if (ver) return ver

        logger.modManager.error('Не удалось извлечь версию из app.asar ни по одному известному пути')
        return '0.0.0'
    } catch (e) {
        logger.modManager.error('Не удалось прочитать версию из app.asar: ' + (e as Error).message)
        return '0.0.0'
    }
}
