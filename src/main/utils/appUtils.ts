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
import { extractAll, createPackage } from '@electron/asar';
import * as plist from 'plist';

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
                    } else {
                        app.quit()
                    }
                })
        }
    }
}

export class AsarCalculator {
  constructor(private filePath: string) {}

  private getHeaderSize(): number {
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const headerBuf = Buffer.alloc(16);
      fs.readSync(fd, headerBuf, 0, 16, 0);
      return headerBuf.readUInt32LE(12);
    } finally {
      fs.closeSync(fd);
    }
  }

  private readHeader(): Buffer {
    const size = this.getHeaderSize();
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 16);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  }

  public calcHash(): string {
    const header = this.readHeader();
    return crypto.createHash('sha256').update(header).digest('hex');
  }
}

export class AsarPatcher {
  public extractAsar(inputAsar: string, outDir: string): void {
    try {
      extractAll(inputAsar, outDir);
      console.log(`✔ Extracted ${inputAsar} → ${outDir}`);
    } catch (err: any) {
      throw new Error(`Failed to extract ${inputAsar}: ${err.message}`);
    }
  }

  public packAsar(input: string, appBundlePath: string): void {
    const outAsar = path.join(appBundlePath, 'Contents', 'Resources', 'app.asar');
    const plistPath = path.join(appBundlePath, 'Contents', 'Info.plist');

    if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
      try {
        createPackage(input, outAsar);
        console.log(`✔ Packed directory ${input} → ${outAsar}`);
      } catch (err: any) {
        throw new Error(`Failed to pack directory ${input}: ${err.message}`);
      }
    } else if (path.extname(input).toLowerCase() === '.asar') {
      try {
        fs.copyFileSync(input, outAsar);
        console.log(`✔ Copied ASAR ${input} → ${outAsar}`);
      } catch (err: any) {
        throw new Error(`Failed to copy ASAR ${input}: ${err.message}`);
      }
    } else {
      throw new Error('Input must be a directory or an .asar file');
    }

    if (this.usesIntegrity(plistPath)) {
      console.log('ℹ ElectronAsarIntegrity detected — recalculating hash…');
      const newHash = new AsarCalculator(outAsar).calcHash();
      this.patchPlistHash(plistPath, newHash);
      console.log(`✔ Updated Info.plist hash to ${newHash}`);
    }

    const entFile = this.dumpEntitlements(appBundlePath);
    try {
      execSync(
        `codesign --force --entitlements "${entFile}" --sign - "${appBundlePath}"`,
        { stdio: 'inherit' }
      );
      console.log(`✔ Re-signed ${appBundlePath}`);
    } finally {
      if (fs.existsSync(entFile)) fs.unlinkSync(entFile);
    }
  }

  private usesIntegrity(plistPath: string): boolean {
    const xml = fs.readFileSync(plistPath, 'utf8');
    const data = plist.parse(xml) as any;
    return Boolean(data.ElectronAsarIntegrity?.Resources?.['app.asar']);
  }

  private patchPlistHash(plistPath: string, hash: string): void {
    const xml = fs.readFileSync(plistPath, 'utf8');
    const data = plist.parse(xml) as any;
    data.ElectronAsarIntegrity.Resources['app.asar'].hash = hash;
    fs.writeFileSync(plistPath, plist.build(data), 'utf8');
  }

  private dumpEntitlements(appPath: string): string {
    const out = path.join(os.tmpdir(), 'extracted_entitlements.plist');
    execSync(`codesign -d --entitlements :- "${appPath}" > "${out}"`);
    return out;
  }
}
