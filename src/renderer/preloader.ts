import type { BootstrapStatusKey, BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

const DOWNLOAD_TEXT = 'Загрузка обновления'
const PREPARATION_TEXT = 'Подготовка обновления'

const STATUS_TEXT: Record<BootstrapStatusKey, string> = {
    'checking-for-updates': 'Проверка обновлений',
    'downloading-client': DOWNLOAD_TEXT,
    'downloading-modules': DOWNLOAD_TEXT,
    'planning-update': PREPARATION_TEXT,
    'preparing-update': PREPARATION_TEXT,
    'restarting-client': 'Перезапуск PulseSync',
    'launching-client': 'Запуск PulseSync',
    'update-blocked': 'Обновление недоступно',
    'update-failed': 'Не удалось обновить PulseSync',
    'bootstrapper-missing': 'Установка PulseSync повреждена',
    'launch-blocked': 'Запуск PulseSync временно недоступен',
    'launch-failed': 'Не удалось запустить PulseSync',
    'renderer-unavailable': 'Не удалось загрузить интерфейс',
}

const root = document.querySelector<HTMLElement>('#bootstrap-root')
const status = document.querySelector<HTMLElement>('#bootstrap-status')
const progress = document.querySelector<HTMLProgressElement>('#bootstrap-progress')
const progressText = document.querySelector<HTMLElement>('#bootstrap-progress-text')
const progressPercent = document.querySelector<HTMLElement>('#bootstrap-progress-percent')
const progressDetails = document.querySelector<HTMLElement>('#bootstrap-progress-details')
const progressSpeed = document.querySelector<HTMLElement>('#bootstrap-progress-speed')

let speedTimeout: number | undefined
function formatDiagnostic(state: BootstrapUiStateV1): string {
    if (state.phase !== 'error' || !state.diagnostic) return ''
    return state.diagnostic.reference ? `${state.diagnostic.code} · ${state.diagnostic.reference}` : state.diagnostic.code
}

function renderState(state: BootstrapUiStateV1): void {
    if (root) {
        root.dataset.phase = state.phase
        root.dataset.progress = state.progress.kind
    }
    const statusText = STATUS_TEXT[state.statusKey]
    if (status && status.textContent !== statusText) {
        status.textContent = statusText
    }
    window.clearTimeout(speedTimeout)
    if (progressSpeed) {
        progressSpeed.hidden = state.bytesPerSecond === undefined
        progressSpeed.textContent = state.bytesPerSecond === undefined ? '' : `${formatBytes(state.bytesPerSecond)}/с`
        if (state.bytesPerSecond !== undefined) {
            speedTimeout = window.setTimeout(() => {
                progressSpeed.textContent = '0 Б/с'
            }, 2000)
        }
    }
    if (progress && progressText && progressPercent && progressDetails) {
        progressPercent.hidden = state.progress.kind !== 'bytes'
        if (state.progress.kind === 'bytes') {
            progress.max = state.progress.total
            progress.value = state.progress.read
            const percent = Math.min(100, Math.floor((state.progress.read / state.progress.total) * 100))
            progressText.hidden = false
            progressPercent.textContent = `${percent}%`
            progressDetails.textContent = formatDownloadBytes(state.progress.read, state.progress.total)
        } else {
            progress.removeAttribute('value')
            progress.max = 1
            const diagnostic = formatDiagnostic(state)
            progressText.hidden = !diagnostic && state.bytesPerSecond === undefined
            progressPercent.textContent = ''
            progressDetails.textContent = diagnostic
        }
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} Б`
    }
    const units = ['КБ', 'МБ', 'ГБ']
    let value = bytes / 1024
    let unit = units[0]
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
        value /= 1024
        unit = units[index]
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

function formatDownloadBytes(read: number, total: number): string {
    const readText = formatBytes(read)
    const totalText = formatBytes(total)
    const unit = totalText.slice(totalText.lastIndexOf(' '))
    const readAmount = readText.endsWith(unit) ? readText.slice(0, -unit.length) : readText
    return `${readAmount} / ${totalText}`
}

const api = window.pulsesyncBootstrap
if (api) {
    api.onState(renderState)
    api.ready()
} else {
    renderState({
        schemaVersion: 1,
        phase: 'error',
        statusKey: 'launch-failed',
        progress: { kind: 'indeterminate' },
        actions: [],
        diagnostic: { code: 'LF-PRELOAD' },
    })
}
