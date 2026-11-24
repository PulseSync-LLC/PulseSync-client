import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useListening } from '@app/providers/ListeningProvider'
import PageLayout from '@widgets/layout/PageLayout'
import { desktopApi } from '@shared/desktop/desktopApi'
import Button from '@shared/ui/buttonV2'

import * as styles from './joint.module.scss'

import type { ListeningOperation } from '@common/listening/types'

export default function JointPage() {
    const { t } = useTranslation()
    const state = useListening()
    const [invitation, setInvitation] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const room = state.room
    const host = room?.hostUserId === state.userId
    const owner = room?.ownerUserId === state.userId
    const offered = room?.hostOffer?.targetUserId === state.userId
    const run = async (operation: ListeningOperation) => {
        setBusy(true)
        setError('')
        try {
            const result = await desktopApi.listening.run(operation)
            if (!result.ok) setError(result.error ?? 'UNAVAILABLE')
            if (result.invitation) await desktopApi.system.writeClipboardText(result.invitation)
        } catch {
            setError('UNAVAILABLE')
        } finally {
            setBusy(false)
        }
    }
    const issue = error || state.error
    return (
        <PageLayout title={t('pages.joint.title')}>
            <section className={styles.panel}>
                <h2>{t('pages.joint.title')}</h2>
                <p>{t('pages.joint.description')}</p>
                {!state.modReady && <p role="status">{t('pages.joint.modRequired')}</p>}
                <p role="status">{t(`pages.joint.connection.${state.connection}`)}</p>
                {issue && <p role="alert">{t(`pages.joint.errors.${issue}`, { defaultValue: t('pages.joint.errors.UNAVAILABLE') })}</p>}
                {!room ? (
                    <>
                        <Button disabled={busy || !state.modReady} onClick={() => void run({ type: 'create' })}>
                            {t('pages.joint.create')}
                        </Button>
                        <label htmlFor="listening-invitation">{t('pages.joint.invitation')}</label>
                        <input
                            id="listening-invitation"
                            value={invitation}
                            maxLength={511}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={event => setInvitation(event.target.value)}
                        />
                        <Button disabled={busy || !state.modReady || !invitation.trim()} onClick={() => void run({ type: 'join', invitation })}>
                            {t('pages.joint.join')}
                        </Button>
                    </>
                ) : (
                    <>
                        <p>{t(host ? 'pages.joint.hostHint' : 'pages.joint.listenerHint')}</p>
                        <div className={styles.actions}>
                            {owner && (
                                <Button disabled={busy} onClick={() => void run({ type: 'invite' })}>
                                    {t('pages.joint.copyInvite')}
                                </Button>
                            )}
                            <Button disabled={busy} onClick={() => void run({ type: 'leave' })}>
                                {t('pages.joint.leave')}
                            </Button>
                            {owner && (
                                <Button disabled={busy} onClick={() => void run({ type: 'close' })}>
                                    {t('pages.joint.close')}
                                </Button>
                            )}
                        </div>
                        {offered && (
                            <div className={styles.actions}>
                                <p>{t('pages.joint.offerHint')}</p>
                                <Button disabled={busy || !state.modReady} onClick={() => void run({ type: 'accept' })}>
                                    {t('pages.joint.accept')}
                                </Button>
                                <Button disabled={busy} onClick={() => void run({ type: 'decline' })}>
                                    {t('pages.joint.decline')}
                                </Button>
                            </div>
                        )}
                        <ul className={styles.participants}>
                            {room.participants.map((participant, index) => (
                                <li key={participant.userId}>
                                    <span>
                                        {participant.userId === state.userId
                                            ? t('pages.joint.you')
                                            : t('pages.joint.participant', { number: index + 1 })}{' '}
                                        · {t(participant.role === 'host' ? 'pages.joint.host' : 'pages.joint.listener')} ·{' '}
                                        {t(`pages.joint.following.${participant.following}`)}
                                    </span>
                                    {(host || owner) && participant.role !== 'host' && !room.hostOffer && (
                                        <Button disabled={busy} onClick={() => void run({ type: 'offer', userId: participant.userId })}>
                                            {t('pages.joint.offer')}
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </section>
        </PageLayout>
    )
}
