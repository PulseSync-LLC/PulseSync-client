import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { desktopApi } from '@shared/desktop/desktopApi'
import Button from '@shared/ui/buttonV2'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'

import * as styles from './AddonRecoveryPanel.module.scss'

import type { DesktopAddonRecoveryEntry, DesktopAddonRecoverySnapshot } from '@common/addons/recovery'

type Props = {
    entries: DesktopAddonRecoveryEntry[]
    connection: DesktopAddonRecoverySnapshot['connection']
    enabled: boolean
}

export default function AddonRecoveryPanel({ entries, connection, enabled }: Props) {
    const { t } = useTranslation()
    const [pending, setPending] = useState<string | null>(null)
    const [confirmation, setConfirmation] = useState<DesktopAddonRecoveryEntry | null>(null)
    const [error, setError] = useState('')
    const entryKey = (entry: DesktopAddonRecoveryEntry) => `${entry.sourceId}:${entry.runtime}:${entry.id}`

    const retry = async (entry: DesktopAddonRecoveryEntry) => {
        setConfirmation(null)
        setError('')
        setPending(entryKey(entry))
        try {
            await desktopApi.addons.retryRecovery(entry)
        } catch (reason) {
            console.error('[Addon recovery] Retry failed:', reason)
            setError(t('extensions.recovery.retryFailed'))
        } finally {
            setPending(null)
        }
    }

    const copyDetails = async (entry: DesktopAddonRecoveryEntry) => {
        try {
            await desktopApi.system.writeClipboardText(
                JSON.stringify(
                    {
                        addon: entry.name,
                        id: entry.id,
                        runtime: entry.runtime,
                        fingerprint: entry.fingerprint,
                        failedAt: new Date(entry.failedAt).toISOString(),
                        reason: entry.reason,
                        details: entry.details,
                    },
                    null,
                    2,
                ),
            )
            toast.custom('success', t('common.doneTitle'), t('extensions.recovery.copied'))
        } catch {
            setError(t('extensions.recovery.copyFailed'))
        }
    }

    if (!entries.length) {
        return enabled && connection !== 'connected' ? <p className={styles.unavailable}>{t(`extensions.recovery.${connection}`)}</p> : null
    }

    return (
        <>
            <CustomModalPS
                isOpen={confirmation !== null}
                onClose={() => setConfirmation(null)}
                title={t('extensions.recovery.restartTitle')}
                text={t('extensions.recovery.restartDescription')}
                buttons={[
                    { text: t('common.cancel'), onClick: () => setConfirmation(null), variant: 'secondary' },
                    {
                        text: t('extensions.recovery.restartAction'),
                        onClick: () => {
                            if (confirmation) void retry(confirmation)
                        },
                    },
                ]}
            />
            {entries.map(entry => {
                const retrying = entry.status === 'retrying' || pending === entryKey(entry)
                const connected = entry.connected && connection === 'connected'
                const rendererCrash = entry.reason.startsWith('renderer-') || entry.reason === 'crashed' || entry.reason === 'oom'
                return (
                    <section key={entryKey(entry)} className={styles.panel} aria-label={t('extensions.recovery.blocked')}>
                        <strong>{t(retrying ? 'extensions.recovery.retrying' : 'extensions.recovery.blocked')}</strong>
                        <p>{t(rendererCrash ? 'extensions.recovery.rendererCrash' : 'extensions.recovery.description')}</p>
                        <p className={styles.timestamp}>{new Date(entry.failedAt).toLocaleString()}</p>
                        {!connected ? <p>{t('extensions.recovery.disconnected')}</p> : null}
                        {!enabled ? <p>{t('extensions.recovery.disabled')}</p> : null}
                        <Button
                            disabled={!enabled || !connected || !!pending || retrying}
                            onClick={() => {
                                if (entry.runtime === 'legacy') setConfirmation(entry)
                                else void retry(entry)
                            }}
                        >
                            {t(retrying ? 'extensions.recovery.retrying' : 'extensions.recovery.retry')}
                        </Button>
                        <details className={styles.details}>
                            <summary>{t('extensions.recovery.details')}</summary>
                            <pre>{[entry.name, entry.runtime, entry.id, entry.reason, entry.details].filter(Boolean).join('\n')}</pre>
                            <Button onClick={() => void copyDetails(entry)}>{t('extensions.recovery.copy')}</Button>
                        </details>
                    </section>
                )
            })}
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
        </>
    )
}
