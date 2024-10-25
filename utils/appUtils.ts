import { psList } from '@heyikang/ps-list'
import { exec } from 'child_process'
import path from 'path'
import util from 'util'
import os from 'os'
import * as crypto from 'node:crypto'
import { EasyAsar } from 'asar-async'
import { getRawHeader } from '@electron/asar'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import fs from "fs";
import logger from '../src/main/modules/logger'
import {mainWindow} from "../src";

const execPromise = util.promisify(exec)

async function isProcessRunning(processName: string): Promise<number | null> {
    try {
        if (isMac()) {
            const { stdout } = await execPromise(`pgrep -x "${processName}"`)
            return stdout ? parseInt(stdout, 10) : null
        } else {
            const modulesVendorPath = path.join(
                __dirname,
                '../../../../modules/vendor/',
            )
            const processes = await psList({
                pslistX64Path: modulesVendorPath + 'fastlist-0.3.0-x64.exe',
                pslistIa32Path: modulesVendorPath + 'fastlist-0.3.0-x86.exe',
            })
            const process = processes.find(p => p.name === processName)
            return process ? process.pid : null
        }
    } catch (error) {
        console.error('Error while getting process list:', error)
        return null
    }
}

async function killProcess(pid: number): Promise<void> {
    try {
        if (isMac()) {
            await execPromise(`kill -9 ${pid}`)
        } else {
            await execPromise(`taskkill /PID ${pid} /F`)
        }
        console.log(`Process with PID ${pid} killed.`)
    } catch (error) {
        console.error('Error while killing process:', error)
    }
}

async function checkAndTerminateYandexMusic() {
    const processName = isMac() ? 'Яндекс Музыка' : 'Яндекс Музыка.exe'
    const pid = await isProcessRunning(processName)
    if (pid !== null) {
        console.log(`${processName} found process with ${pid}. Kill...`)
        await killProcess(pid)
    } else {
        console.log(`${processName} not found.`)
    }
}

export async function checkAndStartYandexMusic() {
    const musicPath = await getPathToYandexMusic()
    const appPath = isMac()
        ? path.join(musicPath, '../../')
        : `"${path.join(musicPath, '../', 'Яндекс Музыка.exe')}"`
    const command = isMac()
        ? `open -a "${appPath}" --args --remote-allow-origins=*`
        : `${appPath} --remote-allow-origins=*`

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Ошибка при выполнении команды: ${error}`)
            return
        }
    })
}

export async function getPathToYandexMusic() {
    if (isMac()) {
        return path.join(
            '/Applications',
            'Яндекс Музыка.app',
            'Contents',
            'Resources',
        )
    } else {
        return path.join(
            process.env.LOCALAPPDATA,
            'Programs',
            'YandexMusic',
            'resources',
        )
    }
}

export const isMac = () => {
    return os.platform() === 'darwin'
}

export async function calculateSHA256FromAsar(
    asarPath: string,
): Promise<string> {
    return crypto
        .createHash('sha256')
        .update(getRawHeader(asarPath).headerString)
        .digest('hex')
}
export default checkAndTerminateYandexMusic
