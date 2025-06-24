import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fs from 'original-fs'
import { asarBackup, musicPath } from '../../index'
import { app, BrowserWindow, dialog } from 'electron'
import axios from 'axios'
import { execSync } from 'child_process'
import * as plist from 'plist'
import asar from '@electron/asar'
import { promises as fsp } from 'original-fs'
import { mainWindow } from '../modules/createWindow'
import logger from '../modules/logger'
import { getState } from '../modules/state'
import config from '../../renderer/api/config'

const execAsync = promisify(exec)
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

async function getYandexMusicProcesses(): Promise<ProcessInfo[]> {
    if (isMac()) {
        try {
            const command = `pgrep -f "Яндекс Музыка"`
            const { stdout } = await execAsync(command, { encoding: 'utf8' })
            const processes = stdout.split('\n').filter(line => line.trim() !== '')
            const yandexProcesses: ProcessInfo[] = processes.map(pid => ({ pid: parseInt(pid, 10) })).filter(proc => !isNaN(proc.pid))
            return yandexProcesses
        } catch (error) {
            logger.main.error('Error retrieving Yandex Music processes on Mac:', error)
            return []
        }
    } else {
        try {
            const command = `tasklist /FI "IMAGENAME eq Яндекс Музыка.exe" /FO CSV /NH`
            const { stdout } = await execAsync(command, { encoding: 'utf8' })
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
    const yandexProcesses = await getYandexMusicProcesses()
    return yandexProcesses
}

export async function closeYandexMusic(): Promise<void> {
    const yandexProcesses = await isYandexMusicRunning()
    if (yandexProcesses.length === 0) {
        logger.main.info('Yandex Music is not running.')
        return
    }

    for (const proc of yandexProcesses) {
        try {
            process.kill(proc.pid)
            logger.main.info(`Yandex Music process with PID ${proc.pid} has been terminated.`)
        } catch (error) {
            logger.main.error(`Error terminating process ${proc.pid}:`, error)
        }
    }
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

    switch (platform) {
        case 'darwin':
            return Promise.resolve(path.join('/Applications', 'Яндекс Музыка.app', 'Contents', 'Resources'))

        case 'win32':
            return Promise.resolve(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'resources'))

        case 'linux':
            const installed = await checkYandexMusicLinuxInstall()
            return installed ? path.join('/usr', 'lib', 'yandex-music') : State.get('settings.modSavePath') || ''

        default:
            return Promise.resolve('')
    }
}
export function getYandexMusicAppDataPath() {
    const platform = os.platform()
    const home = os.homedir()
    switch (platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'YandexMusic')
        case 'win32':
            return path.join(process.env.APPDATA || '', 'YandexMusic')
        case 'linux':
            const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
            return path.join(xdgConfig, 'YandexMusic')
        default:
            return ''
    }
}

export async function copyFile(target: string, dest: string) {
    await fsp.copyFile(target, dest)
}

export async function createDirIfNotExist(target: string) {
    if (!fs.existsSync(target)) {
        await fsp.mkdir(target)
    }
}

const platform = os.platform()

export const isMac = () => platform === 'darwin'
export const isWindows = () => platform === 'win32'
export const isLinux = () => platform === 'linux'

export const formatSizeUnits = (bytes: any) => {
    if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + ' GB'
    } else if (bytes >= 1048576) {
        return (bytes / 1048576).toFixed(2) + ' MB'
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB'
    } else if (bytes > 1) {
        return bytes + ' bytes'
    } else if (bytes == 1) {
        return bytes + ' byte'
    } else {
        return '0 byte'
    }
}
export const getFolderSize = async (folderPath: any) => {
    let totalSize = 0

    const files = await fs.promises.readdir(folderPath)

    for (const file of files) {
        const filePath = path.join(folderPath, file)
        const stats = await fs.promises.stat(filePath)

        if (stats.isDirectory()) {
            totalSize += await getFolderSize(filePath)
        } else {
            totalSize += stats.size
        }
    }

    return totalSize
}
export const formatJson = (data: any) => JSON.stringify(data, null, 4)

export const checkAsar = () => {
    if (State.get('mod.installed') || State.get('mod.version')) {
        if (!fs.existsSync(asarBackup)) {
            State.delete('mod')
        }
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
                if (result.response === 0) {
                    await downloadYandexMusic()
                } else {
                    app.quit()
                }
            })
    }
}

export const downloadYandexMusic = async (type?: string) => {
    const latestYmlResponse = await axios.get('https://music-desktop-application.s3.yandex.net/stable/latest.yml')
    const data = latestYmlResponse.data
    const versionMatch = data.match(/version:\s*([\d.]+)/)
    if (!versionMatch) {
        throw new Error('Версия не найдена в latest.yml')
    }
    const version = versionMatch[1]

    let downloadUrl: string
    let fileName: string

    if (isMac()) {
        downloadUrl = `https://music-desktop-application.s3.yandex.net/stable/Yandex_Music_universal_${version}.dmg`
        fileName = `Yandex_Music_universal_${version}.dmg`
    } else {
        downloadUrl = `https://music-desktop-application.s3.yandex.net/stable/Yandex_Music_x64_${version}.exe`
        fileName = `Yandex_Music_x64_${version}.exe`
    }

    const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

    try {
        await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true })

        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
        })

        const totalLength = parseInt(response.headers['content-length'], 10)
        let downloadedLength = 0
        const writer = fs.createWriteStream(downloadPath)

        response.data.on('data', (chunk: any) => {
            downloadedLength += chunk.length
            const progress = downloadedLength / totalLength
            mainWindow.webContents.send('download-music-progress', {
                progress: Math.round(progress * 100),
            })
            mainWindow.setProgressBar(progress)
        })

        await new Promise<void>((resolve, reject) => {
            writer.on('finish', () => resolve())
            writer.on('error', error => reject(error))
            response.data.pipe(writer)
        })

        writer.close()
        mainWindow.setProgressBar(-1)
        fs.chmodSync(downloadPath, 0o755)

        setTimeout(() => {
            execFile(downloadPath, error => {
                if (error) {
                    mainWindow.webContents.send('download-music-failure', {
                        success: false,
                        error: `Failed to execute the file: ${error.message}`,
                    })
                    return
                }
                fs.unlinkSync(downloadPath)
                checkAsar()
                mainWindow.webContents.send('download-music-execution-success', {
                    success: true,
                    message: 'File executed successfully.',
                    type: type || 'update',
                })
            })
        }, 100)
    } catch (error) {
        mainWindow.setProgressBar(-1)
        if (fs.existsSync(downloadPath)) {
            fs.unlinkSync(downloadPath)
        }
        mainWindow.webContents.send('download-music-failure', {
            success: false,
            error: `Error downloading file: ${error.message}`,
        })
    }
}

export type PatchCallback = (progress: number, message: string) => void

export class AsarPatcher {
    private readonly appBundlePath: string
    private readonly resourcesDir: string
    private readonly infoPlistPath: string
    private asarRelPath = 'app.asar'
    private readonly asarPath: string
    private readonly tmpEntitlements: string

    constructor(appBundlePath: string) {
        this.appBundlePath = appBundlePath
        this.resourcesDir = path.join(appBundlePath, 'Contents', 'Resources')
        this.infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist')
        this.asarPath = path.join(this.resourcesDir, this.asarRelPath)
        this.tmpEntitlements = path.join(os.tmpdir(), 'extracted_entitlements.xml')
    }

    private get isMac(): boolean {
        return os.platform() === 'darwin'
    }

    private calcAsarHeaderHash(archivePath: string) {
        const headerString = asar.getRawHeader(archivePath).headerString
        const hash = crypto.createHash('sha256').update(headerString).digest('hex')
        return { algorithm: 'SHA256', hash }
    }

    private dumpEntitlements(): void {
        execSync(`codesign -d --entitlements :- '${this.appBundlePath}' > '${this.tmpEntitlements}'`, { stdio: 'ignore' })
    }

    private isAsarIntegrityEnabled(): boolean {
        try {
            execSync(`plutil -p '${this.infoPlistPath}' | grep -q ElectronAsarIntegrity`)
            return true
        } catch {
            return false
        }
    }

    private isSystemIntegrityProtectionEnabled(): boolean {
        try {
            const status = execSync('csrutil status', { encoding: 'utf8' })
            return status.includes('Filesystem Protections: enabled')
        } catch {
            return true
        }
    }

    public async patch(callback?: PatchCallback): Promise<boolean> {
        if (!this.isMac) {
            callback?.(0, 'Патч доступен только на macOS')
            return false
        }

        try {
            await fsp.access(this.asarPath, fs.constants.W_OK)
        } catch (err) {
            logger.main.log('Caught access-error, full object dump:', err)
            logger.main.log('Error code:', err.code)
            logger.main.log('Error message:', err.message)
            logger.main.log('Error stack:', err.stack)
            await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Требуются права',
                message: 'Нужны права на запись диска для патча ASAR. Предоставьте доступ и повторите.',
                buttons: ['Открыть настройки', 'Отмена'],
                cancelId: 1,
            })
            execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"')
            return false
        }

        if (this.isSystemIntegrityProtectionEnabled()) {
            callback?.(0, 'SIP (защита файловой системы) включён — отключите эту опцию и повторите')
            return false
        }

        try {
            if (this.isAsarIntegrityEnabled()) {
                callback?.(0.2, 'Обнаружена проверка целостности ASAR, обновляем хеш...')
                const newHash = this.calcAsarHeaderHash(this.asarPath).hash

                const raw = await fsp.readFile(this.infoPlistPath, 'utf8')
                const data = plist.parse(raw) as any
                data.ElectronAsarIntegrity = data.ElectronAsarIntegrity || {}
                data.ElectronAsarIntegrity['Resources/app.asar'].hash = newHash
                await fsp.writeFile(this.infoPlistPath, plist.build(data), 'utf8')

                callback?.(0.5, `Новый хеш: ${newHash}`)
            }

            callback?.(0.6, 'Дампим entitlements...')
            this.dumpEntitlements()

            callback?.(0.7, 'Переподписываем приложение...')
            execSync(`codesign --force --entitlements '${this.tmpEntitlements}' --sign - '${this.appBundlePath}'`, { stdio: 'ignore' })

            await fsp.unlink(this.tmpEntitlements)

            callback?.(1, 'Патч завершён успешно')
            return true
        } catch (err) {
            try {
                await fsp.unlink(this.tmpEntitlements)
            } catch (err) {
                callback?.(0, `Ошибка при удалении временного файла entitlements: ${(err as Error).message}`)
            }
            callback?.(0, `Ошибка при патче: ${(err as Error).message}`)
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

    const entries = await fsp.readdir(directoryPath)
    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry)
        const stat = await fsp.stat(fullPath)

        if (stat.isDirectory()) {
            await clearDirectory(fullPath)
            await fsp.rmdir(fullPath)
        } else {
            await fsp.unlink(fullPath)
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
            if (error && stderr.trim()) {
                return reject(new Error(`PowerShell error: ${stderr.trim()}`))
            }
            const out = stdout.trim()
            if (!out) {
                resolve(null)
                return
            }
            try {
                const pkg: AppxPackage = JSON.parse(out)
                resolve(pkg)
            } catch (e) {
                reject(new Error(`Ошибка разбора JSON: ${(e as Error).message}`))
            }
        })
    })
}

export function uninstallApp(packageFullName: string): Promise<void> {
    const cmd = `powershell.exe -NoProfile -NonInteractive -Command "Remove-AppxPackage -Package '${packageFullName}'"`
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr.trim() || error.message))
            }
            resolve()
        })
    })
}

export const getYandexMusicVersion = async (): Promise<string> => {
    if (isLinux()) {
        try {
            const { stdout } = await execAsync('dpkg-query -W -f=${Version} yandex-music')
            const version = stdout.trim()
            if (version) {
                return version
            }
        } catch {}

        try {
            const { stdout } = await execAsync('rpm -q --qf "%{VERSION}-%{RELEASE}" yandex-music')
            const version = stdout.trim()
            if (version && !version.startsWith('package yandex-music is not installed')) {
                return version
            }
        } catch {}

        try {
            const { stdout } = await execAsync('pacman -Q yandex-music')
            const parts = stdout.trim().split(/\s+/)
            if (parts.length >= 2) {
                const full = parts[1]
                const version = full.split('-')[0]
                if (version) {
                    return version
                }
            }
        } catch {}
    }

    const cfgPath = path.join(getYandexMusicAppDataPath(), 'config.json')
    if (!fs.existsSync(cfgPath)) throw new Error('Файл config.json не найден')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    if (!cfg.version) throw new Error('Версия не найдена в config.json')
    return cfg.version
}
