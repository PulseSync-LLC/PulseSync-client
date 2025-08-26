import { app, dialog, shell, Notification } from 'electron'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import * as crypto from 'crypto'
import * as semver from 'semver'
import { EventEmitter } from 'events'
import { UpdateUrgency } from './constants/updateUrgency'
import { UpdateStatus } from './constants/updateStatus'

export type MacUpdateAsset = {
    arch: 'arm64' | 'x64'
    url: string
    fileType?: 'dmg' | 'zip'
    sha256?: string
    sha512?: string
}

export type MacUpdateManifest = {
    version: string
    url?: string
    fileType?: 'dmg' | 'zip'
    sha256?: string
    sha512?: string
    releaseNotes?: string
    updateUrgency?: UpdateUrgency
    minOsVersion?: string
    assets?: MacUpdateAsset[]
}

export type MacUpdaterOptions = {
    manifestUrl: string
    appName?: string
    downloadsDir?: string
    attemptAutoInstall?: boolean
    openFinderOnMount?: boolean
    onStatus?: (status: UpdateStatus) => void
    onProgress?: (percent: number) => void
    onLog?: (message: string) => void
}

type PickedAsset = {
    arch: 'arm64' | 'x64'
    url: string
    fileType: 'dmg' | 'zip'
    sha256?: string
    sha512?: string
}

export class MacOSUpdater extends EventEmitter {
    private options: MacUpdaterOptions
    private status: UpdateStatus = UpdateStatus.IDLE
    private currentManifest: MacUpdateManifest | null = null
    private downloadedFile: string | null = null
    private pickedAsset: PickedAsset | null = null

    constructor(options: MacUpdaterOptions) {
        super()
        this.options = options
    }

    getStatus() {
        return this.status
    }

    private setStatus(s: UpdateStatus) {
        this.status = s
        this.options.onStatus?.(s)
        this.emit('status', s)
    }

    private log(msg: string) {
        this.options.onLog?.(msg)
        this.emit('log', msg)
    }

    async checkForUpdates(): Promise<MacUpdateManifest | null> {
        if (process.platform !== 'darwin') {
            this.log('MacOSUpdater: пропуск, не macOS')
            return null
        }
        const { manifestUrl } = this.options
        const res = await axios.get<MacUpdateManifest>(manifestUrl, { timeout: 15000 })
        const manifest = res.data
        if (!manifest?.version || (!manifest?.url && !(manifest as any)?.assets?.length)) {
            throw new Error('Некорректный манифест обновления')
        }
        const current = app.getVersion()
        this.log(`Текущая версия ${current}, доступна ${manifest.version}`)
        if (semver.valid(manifest.version) && semver.valid(current)) {
            if (semver.lte(manifest.version, current)) return null
        } else {
            if (manifest.version <= current) return null
        }
        if (manifest.minOsVersion) {
            const release = os.release()
            this.log(`minOsVersion=${manifest.minOsVersion}, os.release=${release}`)
        }
        this.currentManifest = manifest
        return manifest
    }

    async promptAndUpdate(manifest?: MacUpdateManifest) {
        const m = manifest ?? (await this.checkForUpdates())
        if (!m) return
        const urgency = m.updateUrgency ?? UpdateUrgency.SOFT
        const buttons = ['Скачать', 'Позже']
        const detail = `Доступна версия ${m.version}.` + (m.releaseNotes ? '\n\n' + m.releaseNotes : '')
        const res = await dialog.showMessageBox({
            type: urgency === UpdateUrgency.HARD ? 'warning' : 'info',
            buttons,
            defaultId: 0,
            cancelId: 1,
            title: 'Доступно обновление',
            message: `Новая версия: ${m.version}`,
            detail,
        })
        if (res.response === 0) {
            await this.downloadUpdate(m)
            await this.installUpdate(m)
        }
    }

    async downloadUpdate(manifest?: MacUpdateManifest) {
        const m = manifest ?? this.currentManifest
        if (!m) throw new Error('Манифест обновления не найден')
        const hwArch = await this.detectHardwareArch()
        const asset = this.pickAsset(m, hwArch)
        const downloadsDir = this.options.downloadsDir || path.join(app.getPath('userData'), 'updates')
        await fs.promises.mkdir(downloadsDir, { recursive: true })
        const fileName = this.suggestFileName(m, asset)
        const dest = path.join(downloadsDir, fileName)
        const writer = fs.createWriteStream(dest)
        const response = await axios.get(asset.url, { responseType: 'stream' })
        const total = Number(response.headers['content-length'] || 0)
        let received = 0
        const hash512 = crypto.createHash('sha512')
        const hash256 = crypto.createHash('sha256')
        this.setStatus(UpdateStatus.DOWNLOADING)
        await new Promise<void>((resolve, reject) => {
            response.data.on('data', (chunk: Buffer) => {
                received += chunk.length
                hash512.update(chunk)
                hash256.update(chunk)
                if (total) {
                    const percent = Math.min(100, Math.round((received / total) * 100))
                    this.options.onProgress?.(percent)
                    this.emit('progress', percent)
                }
            })
            response.data.on('error', reject)
            writer.on('error', reject)
            writer.on('finish', resolve)
            response.data.pipe(writer)
        })
        const digest512 = hash512.digest('hex')
        const digest256 = hash256.digest('hex')
        if (asset.sha512 && !this.matchDigest(asset.sha512, digest512)) {
            throw new Error('Контрольная сумма sha512 не совпала')
        }
        if (asset.sha256 && !this.matchDigest(asset.sha256, digest256)) {
            throw new Error('Контрольная сумма sha256 не совпала')
        }
        this.downloadedFile = dest
        this.pickedAsset = asset
        this.setStatus(UpdateStatus.DOWNLOADED)
        this.log(`Файл загружен: ${dest}`)
        return dest
    }

    private matchDigest(expected: string, actualHex: string) {
        const normalize = (s: string) =>
            s
                .trim()
                .toLowerCase()
                .replace(/[^a-f0-9]/g, '')
        return normalize(expected) === normalize(actualHex)
    }

    private inferFileTypeFromUrl(u: string): 'dmg' | 'zip' {
        const lower = u.toLowerCase()
        if (lower.endsWith('.zip')) return 'zip'
        return 'dmg'
    }

    private normalizeAsset(a: MacUpdateAsset): PickedAsset {
        return {
            arch: a.arch,
            url: a.url,
            fileType: a.fileType ?? this.inferFileTypeFromUrl(a.url),
            sha256: a.sha256,
            sha512: a.sha512,
        }
    }

    private pickAsset(m: MacUpdateManifest, hwArch: 'arm64' | 'x64'): PickedAsset {
        if (m.assets && m.assets.length) {
            const onlyValid = m.assets.filter(a => a.arch === 'arm64' || a.arch === 'x64')
            const exact = onlyValid.find(a => a.arch === hwArch)
            if (exact) return this.normalizeAsset(exact)
            if (onlyValid.length) return this.normalizeAsset(onlyValid[0])
        }
        if (!m.url) throw new Error('В манифесте нет url/assets')
        return {
            arch: hwArch,
            url: m.url,
            fileType: m.fileType ?? this.inferFileTypeFromUrl(m.url),
            sha256: m.sha256,
            sha512: m.sha512,
        }
    }

    private suggestFileName(m: MacUpdateManifest, asset: PickedAsset) {
        const name = this.options.appName || app.getName()
        return `${name}-${m.version}-${asset.arch}.${asset.fileType}`
    }

    async installUpdate(manifest?: MacUpdateManifest) {
        const m = manifest ?? this.currentManifest
        if (!m) throw new Error('Манифест обновления не найден')
        const filePath = this.downloadedFile
        if (!filePath) throw new Error('Файл обновления не загружен')
        const fileType: 'dmg' | 'zip' = filePath.toLowerCase().endsWith('.zip') ? 'zip' : 'dmg'
        if (fileType === 'dmg') {
            await this.installFromDMG(filePath, m)
        } else {
            await this.installFromZIP(filePath, m)
        }
    }

    private async installFromDMG(dmgPath: string, m: MacUpdateManifest) {
        const { stdout } = await this.runWithOutput('hdiutil', ['attach', dmgPath, '-nobrowse'])
        const mountPoint = this.extractVolume(stdout)
        if (!mountPoint) {
            throw new Error('Том DMG не найден')
        }
        const appBundle = await this.findAppBundle(mountPoint)
        if (!appBundle) {
            if (this.options.openFinderOnMount !== false) {
                await shell.openPath(mountPoint)
            }
            await dialog.showMessageBox({
                type: 'info',
                message: 'Откройте установленный образ',
                detail: 'Мы открыли окно Finder. Перетащите приложение в папку Applications.',
            })
            return
        }
        if (this.options.attemptAutoInstall) {
            await this.copyAndRelaunch(appBundle)
        } else {
            if (this.options.openFinderOnMount !== false) {
                await shell.openPath(mountPoint)
            }
            new Notification({
                title: 'Готово к установке',
                body: 'Перетащите приложение из открытого окна в папку Applications.',
            }).show()
            await dialog.showMessageBox({
                type: 'info',
                buttons: ['Ок'],
                message: 'Готово к установке',
                detail: 'Перетащите приложение из открытого окна в папку Applications. После замены запустите новое приложение.',
            })
        }
    }

    private async installFromZIP(zipPath: string, m: MacUpdateManifest) {
        const unzipDir = path.join(path.dirname(zipPath), `${this.options.appName || app.getName()}-${m.version}-unzipped`)
        await fs.promises.mkdir(unzipDir, { recursive: true })
        await this.runWithOutput('ditto', ['-x', '-k', zipPath, unzipDir])
        const appBundle = await this.findAppBundle(unzipDir)
        if (!appBundle) {
            await shell.openPath(unzipDir)
            await dialog.showMessageBox({
                type: 'info',
                message: 'Распаковано',
                detail: 'Мы открыли папку с распакованным приложением. Перетащите его в папку Applications.',
            })
            return
        }
        if (this.options.attemptAutoInstall) {
            await this.copyAndRelaunch(appBundle)
        } else {
            await shell.openPath(unzipDir)
            await dialog.showMessageBox({
                type: 'info',
                message: 'Готово к установке',
                detail: 'Перетащите приложение в папку Applications. После замены запустите новое приложение.',
            })
        }
    }

    private extractVolume(output: string): string | null {
        const lines = output.split('\n').map(l => l.trim())
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i]
            const m = line.match(/\/Volumes\/[^\s]+/)
            if (m) return m[0]
        }
        return null
    }

    private async findAppBundle(root: string): Promise<string | null> {
        const items = await fs.promises.readdir(root)
        for (const item of items) {
            if (item.endsWith('.app')) {
                return path.join(root, item)
            }
        }
        for (const item of items) {
            const full = path.join(root, item)
            const stat = await fs.promises.stat(full)
            if (stat.isDirectory()) {
                const nested = await this.findAppBundle(full)
                if (nested) return nested
            }
        }
        return null
    }

    private async copyAndRelaunch(bundlePath: string) {
        const target = '/Applications'
        const appName = this.options.appName || app.getName()
        const dest = path.join(target, `${appName}.app`)
        const tmpDest = path.join(target, `${appName}.app.new`)
        const scriptFile = path.join(os.tmpdir(), `${appName}-update.sh`)
        const processName = path.basename(process.execPath)
        const script = [
            'set -e',
            `/usr/bin/xattr -dr com.apple.quarantine "${bundlePath}" || true`,
            `/usr/bin/ditto "${bundlePath}" "${tmpDest}"`,
            '/bin/sleep 0.5',
            `while pgrep -x "${processName}" >/dev/null; do sleep 0.2; done`,
            `[ -d "${dest}" ] && /bin/rm -rf "${dest}" || true`,
            `/bin/mv "${tmpDest}" "${dest}"`,
            `/usr/bin/xattr -dr com.apple.quarantine "${dest}" || true`,
            `open "${dest}"`,
        ].join('\n')
        await fs.promises.writeFile(scriptFile, script, { mode: 0o755 })
        spawn('sh', [scriptFile], { detached: true, stdio: 'ignore' }).unref()
        app.quit()
    }

    private async runWithOutput(cmd: string, args: string[]) {
        const res = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
            const child = spawn(cmd, args)
            let stdout = ''
            let stderr = ''
            child.stdout?.on('data', d => (stdout += String(d)))
            child.stderr?.on('data', d_1 => (stderr += String(d_1)))
            child.on('error', e => reject(e))
            child.on('close', code => resolve({ stdout, stderr, code: Number(code) }))
        })
        if (res.code !== 0) {
            throw new Error(`${cmd} ${args.join(' ')} завершилась с кодом ${res.code}: ${res.stderr}`)
        }
        return res
    }

    private async detectHardwareArch(): Promise<'arm64' | 'x64'> {
        try {
            const { stdout } = await this.runWithOutput('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'])
            const flag = String(stdout).trim()
            if (flag === '1') return 'arm64'
        } catch {}
        return 'x64'
    }
}

export const createMacUpdater = (options: MacUpdaterOptions) => new MacOSUpdater(options)

export const getMacUpdater = (() => {
    let updater: MacOSUpdater | undefined
    return (options?: MacUpdaterOptions) => {
        if (!updater) {
            if (!options) throw new Error('Первый вызов getMacUpdater требует options')
            updater = new MacOSUpdater(options)
        }
        return updater
    }
})()
