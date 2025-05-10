import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fs from 'original-fs'
import { store } from '../modules/storage'
import { asarBackup, mainWindow, musicPath } from '../../index'
import { app, dialog } from 'electron'
import axios from 'axios'

import { execSync } from 'child_process';
import * as plist from 'plist';
import asar from '@electron/asar';
import { promises as fsp } from 'original-fs';

const execAsync = promisify(exec)

interface ProcessInfo {
    pid: number
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
            console.error('Error retrieving Yandex Music processes on Mac:', error)
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
            console.error('Error retrieving Yandex Music processes:', error)
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
        console.info('Yandex Music is not running.')
        return
    }

    for (const proc of yandexProcesses) {
        try {
            process.kill(proc.pid)
            console.info(`Yandex Music process with PID ${proc.pid} has been terminated.`)
        } catch (error) {
            console.error(`Error terminating process ${proc.pid}:`, error)
        }
    }
}

export function getPathToYandexMusic() {
    const platform = os.platform()
    switch (platform) {
        case 'darwin':
            return path.join('/Applications', 'Яндекс Музыка.app', 'Contents', 'Resources')
        case 'win32':
            return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'resources')
        case 'linux':
            return store.get('settings.yandexMusicPath', '')
        default:
            return ''
    }
}

const platform = os.platform()

export const isMac = () => platform === 'darwin'
export const isWindows = () => platform === 'win32'
export const isLinux = () => platform === 'linux'

export async function calculateSHA256FromAsar(asarPath: string): Promise<string> {
    return crypto.createHash('sha256').update(asarPath).digest('hex')
}

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
    if ((store.has('mod.installed') && store.get('mod.installed')) || store.get('mod.version')) {
        if (!fs.existsSync(asarBackup)) {
            store.delete('mod')
        }
    } else if (fs.existsSync(asarBackup)) {
        store.set('mod.installed', true)
    }
}
export const checkMusic = () => {
    if (!fs.existsSync(musicPath)) {
        if (isLinux()) {
            dialog
                .showMessageBox({
                    type: 'info',
                    title: 'Укажите путь к Яндекс Музыке',
                    message: 'Путь к Яндекс Музыке не найден. Пожалуйста, выберите директорию, где установлена Яндекс Музыка.',
                    buttons: ['Выбрать путь', 'Закрыть приложение'],
                })
                .then(result => {
                    if (result.response === 0) {
                        dialog
                            .showOpenDialog({
                                properties: ['openDirectory'],
                            })
                            .then(folderResult => {
                                if (!folderResult.canceled && folderResult.filePaths && folderResult.filePaths[0]) {
                                    store.set('settings.yandexMusicPath', folderResult.filePaths[0])
                                } else {
                                    app.quit()
                                }
                            })
                    } else {
                        app.quit()
                    }
                })
        } else {
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
}

export const downloadYandexMusic = async (type?: string) => {
    const latestYmlResponse = await axios.get('https://music-desktop-application.s3.yandex.net/stable/latest.yml')
    const data = latestYmlResponse.data
    const versionMatch = data.match(/version:\s*([\d.]+)/)
    if (!versionMatch) {
        throw new Error('Версия не найдена в latest.yml')
    }
    const version = versionMatch[1]

    const exeUrl = `https://music-desktop-application.s3.yandex.net/stable/Yandex_Music_x64_${version}.exe`
    const fileName = path.basename(exeUrl)
    const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

    try {
        await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true })

        const response = await axios({
            url: exeUrl,
            method: 'GET',
            responseType: 'stream',
        })

        const totalLength = parseInt(response.headers['content-length'], 10)
        let downloadedLength = 0
        const writer = fs.createWriteStream(downloadPath)

        response.data.on('data', (chunk: string | any[]) => {
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

export class AsarCalculator {
    constructor(private filePath: string) {}

    private getHeaderSize(): number {
        const fd = fs.openSync(this.filePath, 'r')
        try {
            const headerBuf = Buffer.alloc(16)
            fs.readSync(fd, headerBuf, 0, 16, 0)
            return headerBuf.readUInt32LE(12)
        } finally {
            fs.closeSync(fd)
        }
    }

    private readHeader(): Buffer {
        const size = this.getHeaderSize()
        const fd = fs.openSync(this.filePath, 'r')
        try {
            const buf = Buffer.alloc(size)
            fs.readSync(fd, buf, 0, size, 16)
            return buf
        } finally {
            fs.closeSync(fd)
        }
    }

    public calcHash(): string {
        const header = this.readHeader()
        return crypto.createHash('sha256').update(header).digest('hex')
    }
}

export type PatchCallback = (progress: number, message: string) => void;

export class AsarPatcher {
    private readonly appBundlePath: string;
    private readonly resourcesDir: string;
    private readonly infoPlistPath: string;
    private asarRelPath = 'app.asar';
    private asarPath: string;
    private readonly tmpEntitlements: string;

    constructor(appBundlePath: string) {
        this.appBundlePath = appBundlePath;
        this.resourcesDir = path.join(appBundlePath, 'Contents', 'Resources');
        this.infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
        this.asarPath = path.join(this.resourcesDir, this.asarRelPath);
        this.tmpEntitlements = path.join(os.tmpdir(), 'entitlements-extracted.plist');
    }

    private get isMac(): boolean {
        return os.platform() === 'darwin';
    }

    private calcAsarHeaderHash(): string {
        const header = asar.getRawHeader(this.asarPath).headerString;
        return crypto.createHash('sha256').update(header).digest('hex');
    }

    private dumpEntitlements(): void {
        execSync(
            `codesign -d --entitlements :- '${this.appBundlePath}' > '${this.tmpEntitlements}'`,
            { stdio: 'ignore' }
        );
    }

    private isAsarIntegrityEnabled(): boolean {
        try {
            execSync(`plutil -p '${this.infoPlistPath}' | grep -q ElectronAsarIntegrity`);
            return true;
        } catch {
            return false;
        }
    }

    private isSystemIntegrityProtectionEnabled(): boolean {
        try {
            const status = execSync('csrutil status', { encoding: 'utf8' });
            return status.includes('enabled');
        } catch {
            return true;
        }
    }

    public async patch(callback?: PatchCallback): Promise<boolean> {
        if (!this.isMac) {
            callback?.(0, 'Патч доступен только на macOS');
            return false;
        }

        if (this.isSystemIntegrityProtectionEnabled()) {
            callback?.(0, 'SIP включён — отключите System Integrity Protection и повторите');
            return false;
        }

        try {
            if (this.isAsarIntegrityEnabled()) {
                callback?.(0.2, 'Обнаружена проверка целостности ASAR, обновляем хеш...');
                const newHash = this.calcAsarHeaderHash();

                const raw = await fsp.readFile(this.infoPlistPath, 'utf8');
                const data = plist.parse(raw) as any;
                data.ElectronAsarIntegrity = data.ElectronAsarIntegrity || {};
                data.ElectronAsarIntegrity[this.asarRelPath] = { algorithm: 'SHA256', hash: newHash };
                await fsp.writeFile(this.infoPlistPath, plist.build(data), 'utf8');

                callback?.(0.5, `Новый хеш: ${newHash}`);
            }

            callback?.(0.6, 'Дампим entitlements...');
            this.dumpEntitlements();

            callback?.(0.7, 'Переподписываем приложение...');
            execSync(
                `codesign --force --entitlements '${this.tmpEntitlements}' --sign - '${this.appBundlePath}'`,
                { stdio: 'ignore' }
            );

            await fsp.unlink(this.tmpEntitlements);

            callback?.(1, 'Патч завершён успешно');
            return true;

        } catch (err) {
            try { await fsp.unlink(this.tmpEntitlements); } catch {}
            callback?.(0, `Ошибка при патче: ${(err as Error).message}`);
            return false;
        }
    }
}
