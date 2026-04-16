import { execFile } from 'child_process'
import fs, { promises as fsp } from 'original-fs'
import path from 'path'
import { promisify } from 'util'
import logger from './logger'
import { getState } from './state'
import { getYandexMusicAppDataPath, normalizeModSaveDir } from '../utils/appUtils'

const execFileAsync = promisify(execFile)
const State = getState()

type SupportedPlatform = 'win32' | 'darwin' | 'linux'
type SupportedArch = 'x64' | 'arm64'
type ExecutableTargetKey = `${SupportedPlatform}:${SupportedArch}`

export type SubmoduleContext = {
    appRoot?: string | null
    userDataPath?: string | null
}

export type SubmoduleMeta = {
    version: string
    path: string
}

const normalizePath = (value?: string | null): string | null => {
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    return normalizedValue || null
}

const getBaseDirNearAsar = (appRoot: string): string => {
    return appRoot.includes('app.asar') ? path.dirname(appRoot) : appRoot
}

const resolveDefaultExternalAppRoot = (): string | null => {
    const customSavePath = normalizeModSaveDir(State.get('settings.modSavePath') as string | undefined)

    switch (process.platform) {
        case 'darwin':
            return path.join('/Applications', 'Яндекс Музыка.app', 'Contents', 'Resources')
        case 'win32':
            return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'resources')
        case 'linux':
            return customSavePath || path.join('/opt', 'Яндекс Музыка')
        default:
            return null
    }
}

const resolveDefaultExternalUserDataPath = (): string | null => {
    if (process.platform !== 'linux') {
        return null
    }

    return normalizePath(getYandexMusicAppDataPath())
}

const resolveSubmoduleContext = (context: SubmoduleContext = {}): Required<SubmoduleContext> => {
    return {
        appRoot: normalizePath(context.appRoot) ?? resolveDefaultExternalAppRoot(),
        userDataPath: normalizePath(context.userDataPath) ?? resolveDefaultExternalUserDataPath(),
    }
}

const buildExecutablePathMap = (entries: Array<[ExecutableTargetKey, string | null]>): ReadonlyMap<ExecutableTargetKey, string> => {
    return new Map(entries.filter((entry): entry is [ExecutableTargetKey, string] => typeof entry[1] === 'string'))
}

const getInstallerBaseDir = (
    toolName: 'ffmpeg' | 'yt-dlp',
    platform: SupportedPlatform,
    context: Required<SubmoduleContext>,
): string | null => {
    if (platform === 'linux') {
        return context.userDataPath ? path.join(context.userDataPath, toolName) : null
    }

    return context.appRoot ? getBaseDirNearAsar(context.appRoot) : null
}

const joinExecutablePath = (baseDir: string | null, executableName: string): string | null => {
    return baseDir ? path.join(baseDir, executableName) : null
}

// Keep these paths in sync with PulseSync-mod/src/main/lib/ffmpegInstaller.js
export const getFfmpegExecutablePathMap = (context: SubmoduleContext = {}): ReadonlyMap<ExecutableTargetKey, string> => {
    const resolvedContext = resolveSubmoduleContext(context)
    const windowsBaseDir = getInstallerBaseDir('ffmpeg', 'win32', resolvedContext)
    const darwinBaseDir = getInstallerBaseDir('ffmpeg', 'darwin', resolvedContext)
    const linuxBaseDir = getInstallerBaseDir('ffmpeg', 'linux', resolvedContext)

    return buildExecutablePathMap([
        ['win32:x64', joinExecutablePath(windowsBaseDir, 'ffmpeg.exe')],
        ['darwin:x64', joinExecutablePath(darwinBaseDir, 'ffmpeg')],
        ['darwin:arm64', joinExecutablePath(darwinBaseDir, 'ffmpeg')],
        ['linux:x64', joinExecutablePath(linuxBaseDir, 'ffmpeg')],
    ])
}

// Keep these paths in sync with PulseSync-mod/src/main/lib/ytDlpInstaller.js
export const getYtDlpExecutablePathMap = (context: SubmoduleContext = {}): ReadonlyMap<ExecutableTargetKey, string> => {
    const resolvedContext = resolveSubmoduleContext(context)
    const windowsBaseDir = getInstallerBaseDir('yt-dlp', 'win32', resolvedContext)
    const darwinBaseDir = getInstallerBaseDir('yt-dlp', 'darwin', resolvedContext)
    const linuxBaseDir = getInstallerBaseDir('yt-dlp', 'linux', resolvedContext)

    return buildExecutablePathMap([
        ['win32:x64', joinExecutablePath(windowsBaseDir, 'yt-dlp.exe')],
        ['win32:arm64', joinExecutablePath(windowsBaseDir, 'yt-dlp.exe')],
        ['darwin:x64', joinExecutablePath(darwinBaseDir, 'yt-dlp')],
        ['darwin:arm64', joinExecutablePath(darwinBaseDir, 'yt-dlp')],
        ['linux:x64', joinExecutablePath(linuxBaseDir, 'yt-dlp_linux')],
        ['linux:arm64', joinExecutablePath(linuxBaseDir, 'yt-dlp_linux_aarch64')],
    ])
}

const getCurrentTargetKey = (): ExecutableTargetKey => `${process.platform}:${process.arch}` as ExecutableTargetKey

const getFirstNonEmptyLine = (output: string): string | null => {
    const firstLine = output
        .split(/\r\n|[\r\n]/)
        .map(line => line.trim())
        .find(Boolean)

    return firstLine ?? null
}

const extractFfmpegVersion = (output: string): string | null => {
    const versionMatch = output.match(/^ffmpeg version\s+([0-9]+(?:\.[0-9]+)+)/imu)
    if (versionMatch?.[1]) {
        return versionMatch[1].trim()
    }

    return getFirstNonEmptyLine(output)
}

const extractYtDlpVersion = (output: string): string | null => getFirstNonEmptyLine(output)

const getExecutablePath = (pathMap: ReadonlyMap<ExecutableTargetKey, string>): string | null => {
    return pathMap.get(getCurrentTargetKey()) ?? null
}

const pathExists = async (targetPath: string | null): Promise<boolean> => {
    if (!targetPath) {
        return false
    }

    try {
        await fsp.access(targetPath, fs.constants.F_OK)
        return true
    } catch {
        return false
    }
}

const readExecutableVersion = async (
    executablePath: string,
    args: string[],
    parseVersion: (output: string) => string | null,
    label: string,
): Promise<string | null> => {
    try {
        const { stdout, stderr } = (await execFileAsync(executablePath, args, {
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
        })) as { stdout: string; stderr: string }

        return parseVersion(`${stdout}\n${stderr}`)
    } catch (error) {
        logger.main.warn(`Failed to read ${label} version from ${executablePath}: ${String(error)}`)
        return null
    }
}

const getSubmoduleMeta = async (
    executablePath: string | null,
    args: string[],
    parseVersion: (output: string) => string | null,
    label: string,
): Promise<SubmoduleMeta | null> => {
    if (!executablePath || !(await pathExists(executablePath))) {
        return null
    }

    const version = await readExecutableVersion(executablePath, args, parseVersion, label)
    if (!version) {
        return null
    }

    return {
        version,
        path: executablePath,
    }
}

export const getFfmpegExecutablePath = (context: SubmoduleContext = {}): string | null => getExecutablePath(getFfmpegExecutablePathMap(context))

export const getYtDlpExecutablePath = (context: SubmoduleContext = {}): string | null => getExecutablePath(getYtDlpExecutablePathMap(context))

export const getFfmpegMeta = async (context: SubmoduleContext = {}): Promise<SubmoduleMeta | null> => {
    return getSubmoduleMeta(getFfmpegExecutablePath(context), ['-version'], extractFfmpegVersion, 'ffmpeg')
}

export const getYtDlpMeta = async (context: SubmoduleContext = {}): Promise<SubmoduleMeta | null> => {
    return getSubmoduleMeta(getYtDlpExecutablePath(context), ['--version'], extractYtDlpVersion, 'yt-dlp')
}
