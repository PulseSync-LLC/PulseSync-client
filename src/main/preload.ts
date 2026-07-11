import '../styles/globals.css'
import '../styles/preloader.css'
import type { BootstrapAction, BootstrapStatusKey, BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

const STATUS_TEXT: Record<BootstrapStatusKey, string> = {
    'checking-for-updates': 'Проверяем обновления…',
    'downloading-client': 'Скачиваем клиент…',
    'downloading-modules': 'Скачиваем модули…',
    'planning-update': 'Готовим план обновления…',
    'preparing-update': 'Подготавливаем обновление…',
    'restarting-client': 'Перезапускаем PulseSync…',
    'launching-client': 'Запускаем PulseSync…',
    'update-blocked': 'Обновление сейчас невозможно',
    'update-failed': 'Не удалось проверить или подготовить обновление',
    'bootstrapper-missing': 'Установка PulseSync повреждена',
    'launch-blocked': 'PulseSync временно не может запуститься',
    'launch-failed': 'Не удалось запустить PulseSync',
}

const root = document.querySelector<HTMLElement>('#bootstrap-root')
const status = document.querySelector<HTMLElement>('#bootstrap-status')
const progress = document.querySelector<HTMLProgressElement>('#bootstrap-progress')
const progressText = document.querySelector<HTMLElement>('#bootstrap-progress-text')
const progressPercent = document.querySelector<HTMLElement>('#bootstrap-progress-percent')
const progressBytes = document.querySelector<HTMLElement>('#bootstrap-progress-bytes')

let currentState: BootstrapUiStateV1 | undefined
let actionPending = false
let actions: HTMLElement | undefined
let retryButton: HTMLButtonElement | undefined
let continueButton: HTMLButtonElement | undefined

function removeActions(): void {
    actions?.remove()
    actions = undefined
    retryButton = undefined
    continueButton = undefined
}

function ensureActions(canRetry: boolean, canContinue: boolean): void {
    if (!root || (!canRetry && !canContinue)) {
        removeActions()
        return
    }
    if (!actions) {
        actions = document.createElement('div')
        actions.className = 'actions'
        root.appendChild(actions)
    }
    if (canContinue && !continueButton) {
        continueButton = document.createElement('button')
        continueButton.type = 'button'
        continueButton.textContent = 'Продолжить'
        continueButton.addEventListener('click', () => void requestAction('continue'))
        actions.appendChild(continueButton)
    } else if (!canContinue && continueButton) {
        continueButton.remove()
        continueButton = undefined
    }
    if (canRetry && !retryButton) {
        retryButton = document.createElement('button')
        retryButton.type = 'button'
        retryButton.className = 'actions__primary'
        retryButton.textContent = 'Повторить'
        retryButton.addEventListener('click', () => void requestAction('retry'))
        actions.appendChild(retryButton)
    } else if (!canRetry && retryButton) {
        retryButton.remove()
        retryButton = undefined
    }
}

function setActionPending(pending: boolean): void {
    actionPending = pending
    if (retryButton) {
        retryButton.disabled = pending
    }
    if (continueButton) {
        continueButton.disabled = pending
    }
}

function renderState(state: BootstrapUiStateV1): void {
    currentState = state
    if (root) {
        root.dataset.phase = state.phase
        root.dataset.progress = state.progress.kind
    }
    if (status) {
        status.textContent = STATUS_TEXT[state.statusKey]
    }
    if (progress && progressText && progressPercent && progressBytes) {
        if (state.progress.kind === 'bytes') {
            progress.max = state.progress.total
            progress.value = state.progress.read
            const percent = Math.min(100, Math.floor((state.progress.read / state.progress.total) * 100))
            progressText.hidden = false
            progressPercent.textContent = `${percent}%`
            progressBytes.textContent = `${formatBytes(state.progress.read)} из ${formatBytes(state.progress.total)}`
        } else {
            progress.removeAttribute('value')
            progress.max = 1
            const hideText = state.phase === 'blocked' || state.phase === 'error'
            progressText.hidden = hideText
            progressPercent.textContent = hideText ? '' : 'Подождите немного'
            progressBytes.textContent = ''
        }
    }
    const canRetry = state.actions.includes('retry')
    const canContinue = state.actions.includes('continue')
    ensureActions(canRetry, canContinue)
    setActionPending(false)
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

async function requestAction(action: BootstrapAction): Promise<void> {
    if (actionPending || !currentState?.actions.includes(action)) {
        return
    }
    const api = window.pulsesyncBootstrap
    if (!api) {
        return
    }
    setActionPending(true)
    const accepted = action === 'retry' ? await api.retry() : await api.continue()
    if (!accepted) {
        setActionPending(false)
    }
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
    })
}
