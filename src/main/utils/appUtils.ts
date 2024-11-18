import { exec } from 'child_process';
import iconv from 'iconv-lite';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import { getRawHeader } from '@electron/asar';

const execAsync = promisify(exec);

interface ProcessInfo {
    pid: number;
}

async function getYandexMusicProcesses(): Promise<ProcessInfo[]> {
    try {
        const command = `wmic process where "Name=Яндекс Музыка.exe" get ProcessId,CommandLine`;
        const { stdout } = await execAsync(command, { encoding: 'buffer' });

        const output = iconv.decode(Buffer.from(stdout), 'CP866');
        const processes = output.split('\n').filter(line => line.trim() !== '');
        const yandexProcesses: ProcessInfo[] = [];

        processes.forEach(line => {
            if (line.includes('Яндекс Музыка.exe')) {
                const parts = line.trim().split(/\s+/);
                const pidStr = parts[parts.length - 1];
                const pid = parseInt(pidStr, 10);
                if (!isNaN(pid)) {
                    yandexProcesses.push({ pid });
                }
            }
        });

        return yandexProcesses;
    } catch (error) {
        console.error('Error retrieving Yandex Music processes:', error);
        return [];
    }
}

export async function isYandexMusicRunning(): Promise<ProcessInfo[]> {
    const yandexProcesses = await getYandexMusicProcesses();
    return yandexProcesses;
}

export async function closeYandexMusic(): Promise<void> {
    const yandexProcesses = await isYandexMusicRunning();
    if (yandexProcesses.length === 0) {
        console.info('Yandex Music is not running.');
        return;
    }

    for (const proc of yandexProcesses) {
        try {
            process.kill(proc.pid);
            console.info(`Yandex Music process with PID ${proc.pid} has been terminated.`);
        } catch (error) {
            console.error(`Error terminating process ${proc.pid}:`, error);
        }
    }
}

export async function getPathToYandexMusic() {
    if (isMac()) {
        return path.join(
            '/Applications',
            'Yandex Music.app',
            'Contents',
            'Resources',
        );
    } else {
        return path.join(
            process.env.LOCALAPPDATA || '',
            'Programs',
            'YandexMusic',
            'resources',
        );
    }
}

export const isMac = () => {
    return os.platform() === 'darwin';
};

export async function calculateSHA256FromAsar(
    asarPath: string,
): Promise<string> {
    return crypto
        .createHash('sha256')
        .update(getRawHeader(asarPath).headerString)
        .digest('hex');
}

export default closeYandexMusic;
