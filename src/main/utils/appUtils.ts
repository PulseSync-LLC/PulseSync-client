import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import fs from 'original-fs'
import { store } from '../modules/storage'

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
