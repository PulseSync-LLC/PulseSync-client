import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import * as fsp from 'fs/promises'
import fso from 'original-fs'
import { BrowserWindow, ipcMain } from 'electron'
import logger from '../modules/logger'
import RendererEvents from '../../common/types/rendererEvents'
import MainEvents from '../../common/types/mainEvents'
import { t } from '../i18n'

const execAsync = promisify(exec)

type ZapretServiceInfo = {
    Name?: string
    DisplayName?: string
    State?: string
    ProcessId?: number
    PathName?: string
}

type PulseSyncAddResult = { ok: true; message: string } | { ok: false; message: string }

const pendingListGeneralByWebContentsId = new Map<number, string>()

function normalizeOutput(s: string): string {
    return (s ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\u0000/g, '')
        .trim()
}

function splitNonEmptyLines(s: string): string[] {
    return normalizeOutput(s)
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
}

function fileExists(p: string): boolean {
    try {
        return fso.existsSync(p)
    } catch {
        return false
    }
}

async function runCmd(command: string): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execAsync(command, {
        encoding: 'utf8' as BufferEncoding,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: stdout ?? '', stderr: stderr ?? '' }
}

function parseRelevantBinaryFromServicePathName(pathName: string): string | null {
    const pn = normalizeOutput(pathName)
    if (!pn) return null

    const winwsQuoted = pn.match(/"([^"]*winws\.exe)"/i)
    if (winwsQuoted?.[1]) return normalizeOutput(winwsQuoted[1])

    const winwsUnquoted = pn.match(/(^|\s)([^\s"]*winws\.exe)(\s|$)/i)
    if (winwsUnquoted?.[2]) return normalizeOutput(winwsUnquoted[2])

    const quotedCandidates = [...pn.matchAll(/"([^"]+\.(?:exe|cmd|bat|ps1))"/gi)].map(m => m[1]).filter(Boolean)
    const unquotedCandidates = [...pn.matchAll(/(^|\s)([^\s"]+\.(?:exe|cmd|bat|ps1))(\s|$)/gi)].map(m => m[2]).filter(Boolean)

    const candidates = [...quotedCandidates, ...unquotedCandidates].map(x => normalizeOutput(x)).filter(Boolean)

    const bad = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe'])
    for (const c of candidates) {
        const base = path.basename(c).toLowerCase()
        if (!bad.has(base)) return c
    }

    if (candidates.length > 0) return candidates[0]
    return null
}

async function tryGetZapretServiceInfo(): Promise<ZapretServiceInfo | null> {
    const ps = [
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `"` +
            `$svcs = Get-CimInstance Win32_Service | Where-Object { ` +
            `($_.Name -match 'zapret') -or ($_.DisplayName -match 'zapret') -or ($_.PathName -match 'winws\\.exe') ` +
            `}; ` +
            `$svcs = $svcs | Sort-Object @{Expression={if ($_.State -eq 'Running') {0} else {1}}}, Name; ` +
            `$s = $svcs | Select-Object -First 1 Name, DisplayName, State, ProcessId, PathName; ` +
            `if ($null -eq $s) { '' } else { $s | ConvertTo-Json -Compress }` +
            `"`,
    ].join(' ')

    try {
        const { stdout } = await runCmd(ps)
        const out = normalizeOutput(stdout)
        if (!out) return null

        let obj: ZapretServiceInfo | null = null
        try {
            obj = JSON.parse(out) as ZapretServiceInfo
        } catch {
            return null
        }

        if (!obj?.Name && !obj?.DisplayName && !obj?.PathName) return null
        return obj
    } catch (err) {
        logger.main.debug('Zapret service CIM lookup failed:', err)
        return null
    }
}

async function tryGetZapretServiceInfoViaSc(serviceName: string): Promise<ZapretServiceInfo | null> {
    try {
        const qc = await runCmd(`sc qc ${serviceName}`)
        const qclines = splitNonEmptyLines(qc.stdout)
        const binLine = qclines.find(l => l.toUpperCase().includes('BINARY_PATH_NAME'))
        const pathName = binLine ? binLine.split(':').slice(1).join(':').trim() : ''

        const qx = await runCmd(`sc queryex ${serviceName}`)
        const qxlines = splitNonEmptyLines(qx.stdout)
        const stateLine = qxlines.find(l => l.toUpperCase().startsWith('STATE'))
        const pidLine = qxlines.find(l => l.toUpperCase().startsWith('PID'))

        const state = stateLine ? stateLine : ''
        const pid = pidLine ? parseInt(pidLine.split(':').slice(1).join(':').trim(), 10) : undefined

        if (!pathName) return null
        return {
            Name: serviceName,
            State: state,
            ProcessId: Number.isFinite(pid) ? pid : undefined,
            PathName: pathName,
        }
    } catch (err) {
        return null
    }
}

async function getZapretBaseDirIfRunning(): Promise<string | null> {
    let info = await tryGetZapretServiceInfo()

    if (!info) {
        info = await tryGetZapretServiceInfoViaSc('zapret')
    }

    if (!info?.PathName) {
        logger.main.info('zapret service not found (by CIM and sc qc zapret)')
        return null
    }

    const state = normalizeOutput(String(info.State ?? ''))
    const isRunning = /running/i.test(state) || (typeof info.ProcessId === 'number' && info.ProcessId > 0)

    if (!isRunning) {
        logger.main.info(`zapret service found but not running: ${info.Name ?? 'unknown'}`)
        return null
    }

    const binary = parseRelevantBinaryFromServicePathName(String(info.PathName))
    if (!binary) {
        logger.main.warn(`Could not parse binary path from service PathName: ${info.PathName}`)
        return null
    }

    const baseDir = path.dirname(binary)
    logger.main.info(`Using base dir from zapret service: ${baseDir}`)
    return baseDir
}

async function findListGeneralPathFromDir(startDir: string, maxLevels = 8): Promise<string | null> {
    let current = startDir

    for (let i = 0; i < maxLevels; i++) {
        const candidate = path.join(current, 'lists', 'list-general.txt')
        if (fileExists(candidate)) {
            logger.main.info(`Found list-general.txt at: ${candidate}`)
            return candidate
        }

        const parent = path.dirname(current)
        if (!parent || parent === current) break
        current = parent
    }

    return null
}

async function isWinwsRunning(): Promise<boolean> {
    try {
        const command = `tasklist /FI "IMAGENAME eq winws.exe" /FO CSV /NH`
        const { stdout } = await runCmd(command)
        return normalizeOutput(stdout).toLowerCase().includes('winws.exe')
    } catch (error) {
        logger.main.debug('Error checking if winws.exe is running:', error)
        return false
    }
}

async function tryGetWinwsPathViaCimCommandLine(): Promise<string | null> {
    const ps = [
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `"` +
            `$p = Get-CimInstance Win32_Process -Filter "Name='winws.exe'" | Select-Object -First 1 CommandLine; ` +
            `if ($null -eq $p) { '' } else { $p.CommandLine }` +
            `"`,
    ].join(' ')

    try {
        const { stdout } = await runCmd(ps)
        const line = normalizeOutput(stdout)
        if (!line) return null

        const m = line.match(/"([^"]+winws\.exe)"|(^|\s)([^\s"]+winws\.exe)(\s|$)/i)
        const candidate = normalizeOutput((m?.[1] || m?.[3] || '') as string)
        if (!candidate) return null

        logger.main.info(`Found winws.exe via CIM CommandLine: ${candidate}`)
        return candidate
    } catch (err) {
        logger.main.debug('CIM CommandLine approach failed:', err)
        return null
    }
}

function normalizeAndValidateListGeneralPath(p: string): string | null {
    const np = normalizeOutput(p)
    if (!np) return null

    const normalized = path.normalize(np)

    const base = path.basename(normalized).toLowerCase()
    if (base !== 'list-general.txt') return null

    const dirParts = path
        .dirname(normalized)
        .split(path.sep)
        .map(x => x.toLowerCase())

    if (!dirParts.includes('lists')) return null

    if (!path.isAbsolute(normalized)) return null

    return normalized
}

async function getListGeneralPathBestEffort(): Promise<string | null> {
    const zapretBaseDir = await getZapretBaseDirIfRunning()
    if (zapretBaseDir) {
        const p = await findListGeneralPathFromDir(zapretBaseDir, 10)
        if (p) return p
        logger.main.warn('zapret base dir found, but list-general.txt not found by upward search')
    }

    const running = await isWinwsRunning()
    if (!running) return null

    const winwsPath = await tryGetWinwsPathViaCimCommandLine()
    if (!winwsPath) return null

    const winwsDir = path.dirname(winwsPath)
    const p = await findListGeneralPathFromDir(winwsDir, 10)
    return p
}

async function hasPulseSyncEntry(listGeneralPath: string): Promise<boolean> {
    try {
        const fileExistsFlag = fso.existsSync(listGeneralPath)
        if (!fileExistsFlag) {
            logger.main.warn(`File does not exist: ${listGeneralPath}`)
            return false
        }

        const content = await fsp.readFile(listGeneralPath, 'utf-8')
        const lines = splitNonEmptyLines(content)
        const hasPulseSync = lines.some(line => line.toLowerCase() === 'pulsesync.dev')
        const hasRuNode = lines.some(line => line.toLowerCase() === 'ru-node-1.pulsesync.dev')

        logger.main.info(`pulsesync.dev ${hasPulseSync ? 'found' : 'not found'}, ru-node-1.pulsesync.dev ${hasRuNode ? 'found' : 'not found'}`)
        return hasPulseSync && hasRuNode
    } catch (error) {
        logger.main.error('Error checking pulsesync entries in list-general.txt:', error)
        return false
    }
}

function detectEol(content: string): '\r\n' | '\n' {
    return content.includes('\r\n') ? '\r\n' : '\n'
}

async function addPulseSyncEntry(listGeneralPath: string): Promise<boolean> {
    try {
        let content = ''
        const fileExistsFlag = fso.existsSync(listGeneralPath)

        if (fileExistsFlag) {
            content = await fsp.readFile(listGeneralPath, 'utf-8')
            const lines = splitNonEmptyLines(content)
            const hasPulseSync = lines.some(line => line.toLowerCase() === 'pulsesync.dev')
            const hasRuNode = lines.some(line => line.toLowerCase() === 'ru-node-1.pulsesync.dev')

            if (hasPulseSync && hasRuNode) {
                logger.main.info('Both pulsesync.dev and ru-node-1.pulsesync.dev already present, skip write')
                return true
            }
        }

        const eol = detectEol(content)

        if (content && !content.endsWith('\n') && !content.endsWith('\r\n')) {
            content += eol
        }

        content += `pulsesync.dev${eol}`
        content += `ru-node-1.pulsesync.dev${eol}`

        await fsp.writeFile(listGeneralPath, content, 'utf-8')
        logger.main.info('Successfully added pulsesync.dev and ru-node-1.pulsesync.dev to list-general.txt')
        return true
    } catch (error) {
        logger.main.error('Error adding pulsesync entries to list-general.txt:', error)
        return false
    }
}

async function showAddPulseSyncDialog(mainWindow: BrowserWindow, listGeneralPath: string): Promise<void> {
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            logger.main.warn('Main window is not available or destroyed, cannot show renderer modal')
            return
        }

        const validated = normalizeAndValidateListGeneralPath(listGeneralPath)
        if (!validated) {
            logger.main.warn(`Invalid list-general.txt path, skip dialog: ${listGeneralPath}`)
            return
        }

        pendingListGeneralByWebContentsId.set(mainWindow.webContents.id, validated)

        mainWindow.webContents.send(RendererEvents.SHOW_ADD_PULSESYNC_DIALOG, {
            listGeneralPath: validated,
        })
    } catch (error) {
        logger.main.error('Error showing add PulseSync dialog:', error)
    }
}

export function setupPulseSyncDialogHandler(): void {
    try {
        ipcMain.handle(MainEvents.PULSESYNC_ADD_ENTRY, async (event): Promise<PulseSyncAddResult> => {
            try {
                const senderId = event.sender.id
                const pendingPath = pendingListGeneralByWebContentsId.get(senderId)

                if (!pendingPath) {
                    return { ok: false, message: t('main.hostFile.noPendingListGeneralPath') }
                }

                const validated = normalizeAndValidateListGeneralPath(pendingPath)
                if (!validated) {
                    pendingListGeneralByWebContentsId.delete(senderId)
                    return { ok: false, message: t('main.hostFile.invalidListGeneralPath') }
                }

                const success = await addPulseSyncEntry(validated)
                pendingListGeneralByWebContentsId.delete(senderId)

                return success ? { ok: true, message: t('main.hostFile.entriesAdded') } : { ok: false, message: t('main.hostFile.entriesAddFailed') }
            } catch (error) {
                logger.main.error('Error in pulsesync invoke handler:', error)
                return { ok: false, message: t('main.hostFile.entriesAddError') }
            }
        })

        ipcMain.on(MainEvents.PULSESYNC_DISMISS, event => {
            const senderId = event.sender.id
            pendingListGeneralByWebContentsId.delete(senderId)
        })
    } catch (error) {
        logger.main.error('Error setting up PulseSync IPC handlers:', error)
    }
}

export async function checkAndAddPulseSyncOnStartup(mainWindow: BrowserWindow): Promise<void> {
    try {
        logger.main.info('Starting zapret/winws and pulsesync.dev check...')

        const listGeneralPath = await getListGeneralPathBestEffort()
        if (!listGeneralPath) {
            logger.main.debug('Could not determine list-general.txt path (zapret service not running / winws not accessible)')
            return
        }

        const validated = normalizeAndValidateListGeneralPath(listGeneralPath)
        if (!validated) {
            logger.main.warn(`Determined list-general path looks invalid: ${listGeneralPath}`)
            return
        }

        logger.main.debug(`Checking pulsesync.dev in: ${validated}`)
        const hasPulseSync = await hasPulseSyncEntry(validated)

        if (!hasPulseSync) {
            logger.main.info('pulsesync.dev not found, showing add dialog')
            await showAddPulseSyncDialog(mainWindow, validated)
        } else {
            logger.main.info('pulsesync.dev already present in list-general.txt')
        }
    } catch (error) {
        logger.main.warn('Error in checkAndAddPulseSyncOnStartup (continuing anyway):', error)
    }
}
