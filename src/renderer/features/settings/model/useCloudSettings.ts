import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import { synchronizeCloudSettings } from './cloudSettingsSync'

import type { CloudSettingsStatus } from '@common/cloudSettings'
import type Addon from '@entities/addon/model/addon.interface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { CloudSettingsControl } from '@entities/user/model/context/types'
import type { Dispatch, SetStateAction } from 'react'

export const useCloudSettings = (
    userId: string,
    ready: boolean,
    setApp: Dispatch<SetStateAction<SettingsInterface>>,
    setAddons: Dispatch<SetStateAction<Addon[]>>,
): CloudSettingsControl => {
    const { t, i18n } = useTranslation()
    const [status, setStatus] = useState<CloudSettingsStatus>({ enabled: false, pendingDelete: false })
    const [available, setAvailable] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(false)
    const session = useRef('')
    const supported = desktopApi.settings.supportsCloudSync()
    const activeUser = ready && userId !== '-1' && supported ? userId : ''
    session.current = activeUser

    const synchronize = useCallback(
        async (enabled?: boolean) => {
            if (!activeUser) return
            const next = await synchronizeCloudSettings(activeUser, enabled, status => {
                if (session.current !== activeUser) return
                setStatus(status)
                setAvailable(true)
            })
            if (session.current !== activeUser) return
            setStatus(next)
            setAvailable(true)
            setError(next.offline === true)
            if (next.addonsChanged) {
                const addons = await desktopApi.addons.list()
                if (session.current !== activeUser) return
                setAddons(Array.isArray(addons) ? addons : [])
            }
            const snapshot = await desktopApi.settings.getSnapshot()
            if (session.current !== activeUser) return
            setApp(previous => {
                const settings = { ...previous.settings, ...snapshot.settings }
                return JSON.stringify(settings) === JSON.stringify(previous.settings) ? previous : { ...previous, settings }
            })
            const language = snapshot.settings.language
            if (typeof language === 'string' && i18n.language !== language) await i18n.changeLanguage(language)
        },
        [activeUser, i18n, setApp, setAddons],
    )

    useEffect(() => {
        setAvailable(false)
        setStatus({ enabled: false, pendingDelete: false })
        setError(false)
        if (!activeUser) return
        let running = false
        let disposed = false
        const sync = async () => {
            if (running || disposed) return
            running = true
            try {
                await synchronize()
            } catch {
                if (!disposed) setError(true)
            } finally {
                running = false
            }
        }
        void sync()
        const timer = setInterval(() => void sync(), 15_000)
        window.addEventListener('focus', sync)
        return () => {
            disposed = true
            clearInterval(timer)
            window.removeEventListener('focus', sync)
        }
    }, [activeUser, synchronize])

    const setEnabled = useCallback(
        async (enabled: boolean) => {
            if (!activeUser) return
            setBusy(true)
            if (!enabled) setStatus({ enabled: false, pendingDelete: true })
            try {
                await synchronize(enabled)
            } catch {
                if (session.current === activeUser) {
                    setError(true)
                    toast.custom('error', t('common.errorTitle'), t('settingsModal.cloud.error'))
                }
            } finally {
                if (session.current === activeUser) setBusy(false)
            }
        },
        [activeUser, synchronize, t],
    )

    return { ...status, available: available && !!activeUser, busy, error, setEnabled }
}
