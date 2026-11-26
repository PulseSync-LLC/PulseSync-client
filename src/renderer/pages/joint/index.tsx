import { useEffect, useState } from 'react'

import { Button } from '@pulsesync/uikit/actions'
import { Input } from '@pulsesync/uikit/inputs'
import { useTranslation } from 'react-i18next'
import { MdAdd, MdContentCopy, MdLogin, MdLogout, MdRefresh } from 'react-icons/md'

import { useListening } from '@app/providers/ListeningProvider'
import PageLayout from '@widgets/layout/PageLayout'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'

import ListeningDiagnostics from './ui/ListeningDiagnostics'
import ParticipantActions from './ui/ParticipantActions'
import ParticipantProfile from './ui/ParticipantProfile'

import * as styles from './joint.module.scss'

import type { ListeningOperation } from '@common/listening/types'

export default function JointPage() {
    const { t } = useTranslation()
    const state = useListening()
    const [invitation, setInvitation] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [inviteCode, setInviteCode] = useState<{
        roomId: string
        code: string
        createdAt: number
    } | null>(null)
    const room = state.room
    const diagnostics = state.diagnostics
    const connected = state.connection === 'connected'
    const host = room?.hostUserId === state.userId
    const owner = room?.ownerUserId === state.userId
    const offered = room?.hostOffer?.targetUserId === state.userId
    useEffect(() => setError(''), [state.connection, room?.roomId])
    const age = (value: number | null | undefined) =>
        value === null || value === undefined
            ? t('pages.joint.diagnostics.unknown')
            : t('pages.joint.diagnostics.seconds', {
                  count: Math.ceil(value / 1000),
              })
    const retry = async () => {
        setBusy(true)
        setError('')
        try {
            await desktopApi.listening.get()
        } catch {
            setError('CONNECTION_FAILED')
        } finally {
            setBusy(false)
        }
    }
    const run = async (operation: ListeningOperation) => {
        setBusy(true)
        setError('')
        try {
            const result = await desktopApi.listening.run(operation)
            if (!result.ok) setError(result.error ?? 'UNAVAILABLE')
            if (result.invitation) {
                if (room)
                    setInviteCode({
                        roomId: room.roomId,
                        code: result.invitation,
                        createdAt: performance.now(),
                    })
                await desktopApi.system.writeClipboardText(result.invitation)
            }
        } catch {
            setError('UNAVAILABLE')
        } finally {
            setBusy(false)
        }
    }
    const issue = error || state.error
    const activeCode =
        inviteCode && room && inviteCode.roomId === room.roomId && performance.now() - inviteCode.createdAt < 600000 ? inviteCode.code : null
    const copyCode = async () => {
        if (!activeCode) return run({ type: 'invite' })
        try {
            await desktopApi.system.writeClipboardText(activeCode)
        } catch {
            setError('UNAVAILABLE')
        }
    }
    const connecting = state.loading || state.connection === 'connecting'
    const canJoin = !busy && !connecting && state.available && state.modReady && Boolean(invitation.trim())
    const playbackStatus =
        connected && room?.status === 'open' && room.controller?.connection === 'online' ? (room.playback?.actual.status ?? 'waiting') : 'waiting'
    return (
        <PageLayout title={t('pages.joint.title')} className={styles.page}>
            <Scrollbar className={styles.scrollArea} classNameInner={styles.scrollContent}>
                <div className={styles.content}>
                    <header className={styles.header}>
                        <div>
                            <h1>{t(room ? 'pages.joint.ui.roomTitle' : 'pages.joint.ui.startTitle')}</h1>
                            <p>
                                {room && <>{t('pages.joint.roomStatus.' + room.status)} · </>}
                                {t(room ? (host ? 'pages.joint.hostHint' : 'pages.joint.listenerHint') : 'pages.joint.ui.startDescription')}
                            </p>
                        </div>
                        <span className={styles.serviceStatus} data-connected={connected} role="status">
                            <span aria-hidden="true" />
                            {t('pages.joint.connection.' + (connecting ? 'connecting' : state.connection))}
                        </span>
                    </header>
                    {(issue || (room && !connected)) && (
                        <section className={styles.notice} aria-label={t('pages.joint.ui.connectionTitle')}>
                            <div>
                                {issue && (
                                    <p role="alert">{t('pages.joint.errors.' + issue, { defaultValue: t('pages.joint.errors.UNAVAILABLE') })}</p>
                                )}
                                {!connected && diagnostics && diagnostics.reconnectAttempt > 0 && (
                                    <p className={styles.muted}>
                                        {diagnostics.retryInMs === null
                                            ? t('pages.joint.ui.retryAttempt', { attempt: diagnostics.reconnectAttempt })
                                            : t('pages.joint.diagnostics.retry', {
                                                  attempt: diagnostics.reconnectAttempt,
                                                  delay: age(diagnostics.retryInMs),
                                              })}
                                    </p>
                                )}
                            </div>
                            {!connected && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    uppercase={false}
                                    icon={<MdRefresh />}
                                    disabled={busy || connecting}
                                    onClick={() => void retry()}
                                >
                                    {t('pages.joint.retry')}
                                </Button>
                            )}
                        </section>
                    )}
                    <div className={styles.grid}>
                        <div className={styles.mainColumn}>
                            {!room ? (
                                <section className={styles.panel} aria-labelledby="listening-create-title">
                                    <div className={styles.sectionHeading}>
                                        <h2 id="listening-create-title">{t('pages.joint.ui.createTitle')}</h2>
                                        <p>{t('pages.joint.ui.createDescription')}</p>
                                    </div>
                                    <div className={styles.musicConnection}>
                                        <img src={staticAsset('assets/icons/homeYandexMusic.svg')} alt="" />
                                        <div>
                                            <strong>{t('pages.joint.diagnostics.mod')}</strong>
                                            <span>{t(state.modReady ? 'pages.joint.diagnostics.modConnected' : 'pages.joint.ui.notConnected')}</span>
                                        </div>
                                    </div>
                                    {!state.modReady && <p className={styles.hint}>{t('pages.joint.modRequired')}</p>}
                                    <ButtonV2
                                        className={styles.primaryAction}
                                        disabled={busy || connecting || !state.available || !state.modReady}
                                        onClick={() => void run({ type: 'create' })}
                                    >
                                        <MdAdd aria-hidden="true" />
                                        {t('pages.joint.create')}
                                    </ButtonV2>
                                </section>
                            ) : (
                                <>
                                    {offered && (
                                        <section className={styles.offer}>
                                            <p>{t('pages.joint.offerHint')}</p>
                                            <div className={styles.actions}>
                                                <ButtonV2
                                                    className={styles.primaryAction}
                                                    disabled={busy || !connected || !state.modReady}
                                                    onClick={() => void run({ type: 'accept' })}
                                                >
                                                    {t('pages.joint.accept')}
                                                </ButtonV2>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    uppercase={false}
                                                    disabled={busy || !connected}
                                                    onClick={() => void run({ type: 'decline' })}
                                                >
                                                    {t('pages.joint.decline')}
                                                </Button>
                                            </div>
                                        </section>
                                    )}
                                    <section aria-labelledby="listening-participants-title">
                                        <div className={styles.sectionHeader}>
                                            <h2 id="listening-participants-title">{t('pages.joint.ui.participantsTitle')}</h2>
                                            <span className={styles.count}>{room.participants.length}</span>
                                        </div>
                                        {!connected && <p className={styles.hint}>{t('pages.joint.staleParticipants')}</p>}
                                        <ul className={styles.participants}>
                                            {room.participants.map((participant, index) => (
                                                <li key={participant.userId}>
                                                    <ParticipantProfile
                                                        participant={participant}
                                                        index={index}
                                                        self={participant.userId === state.userId}
                                                    />
                                                    <ParticipantActions
                                                        participant={participant}
                                                        room={room}
                                                        userId={state.userId}
                                                        connected={connected}
                                                        busy={busy}
                                                        moderationAvailable={state.moderationAvailable === true}
                                                        playbackStatus={playbackStatus}
                                                        run={run}
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                </>
                            )}
                        </div>
                        <aside className={styles.sidebar}>
                            {!room ? (
                                <form
                                    className={styles.panel}
                                    onSubmit={event => {
                                        event.preventDefault()
                                        if (canJoin) void run({ type: 'join', invitation })
                                    }}
                                >
                                    <div className={styles.sectionHeading}>
                                        <h2>{t('pages.joint.ui.joinTitle')}</h2>
                                        <p id="listening-invitation-hint">{t('pages.joint.ui.joinDescription')}</p>
                                    </div>
                                    <div className={styles.field}>
                                        <label htmlFor="listening-invitation">{t('pages.joint.invitation')}</label>
                                        <Input
                                            id="listening-invitation"
                                            aria-label={t('pages.joint.invitation')}
                                            size="sm"
                                            value={invitation}
                                            maxLength={64}
                                            placeholder="K7MP-4X9D-R2TW"
                                            autoCapitalize="characters"
                                            autoComplete="off"
                                            spellCheck={false}
                                            aria-describedby="listening-invitation-hint"
                                            onChange={event => setInvitation(event.target.value)}
                                        />
                                    </div>
                                    <ButtonV2 type="submit" className={styles.primaryAction} disabled={!canJoin}>
                                        <MdLogin aria-hidden="true" />
                                        {t('pages.joint.join')}
                                    </ButtonV2>
                                </form>
                            ) : (
                                <section className={styles.panel}>
                                    <div className={styles.sectionHeading}>
                                        <h2>{t(owner ? 'pages.joint.ui.inviteTitle' : 'pages.joint.ui.roomTitle')}</h2>
                                        <p>{t(owner ? 'pages.joint.ui.inviteDescription' : 'pages.joint.roomStatus.' + room.status)}</p>
                                    </div>
                                    {owner && (
                                        <>
                                            {activeCode ? (
                                                <Input size="sm" value={activeCode} readOnly aria-label={t('pages.joint.invitation')} />
                                            ) : (
                                                <p className={styles.hint}>{t('pages.joint.ui.codeNotCreated')}</p>
                                            )}
                                            <ButtonV2 className={styles.primaryAction} disabled={busy || !connected} onClick={() => void copyCode()}>
                                                <MdContentCopy aria-hidden="true" />
                                                {t(activeCode ? 'pages.joint.copyInvite' : 'pages.joint.ui.createInvite')}
                                            </ButtonV2>
                                            <p className={styles.hint}>{t('pages.joint.ui.inviteLifetime')}</p>
                                        </>
                                    )}
                                    <div className={styles.roomFooter}>
                                        <Button
                                            variant="ghost"
                                            fullWidth
                                            size="sm"
                                            uppercase={false}
                                            className={styles.leaveButton}
                                            icon={<MdLogout />}
                                            disabled={busy || !connected}
                                            onClick={() => void run({ type: owner ? 'close' : 'leave' })}
                                        >
                                            {t(owner ? 'pages.joint.close' : 'pages.joint.leave')}
                                        </Button>
                                    </div>
                                </section>
                            )}
                            <section className={styles.connectionPanel} aria-labelledby="listening-connection-title">
                                <h2 id="listening-connection-title">{t('pages.joint.ui.connectionTitle')}</h2>
                                <dl className={styles.connectionValues}>
                                    <div>
                                        <dt>{t('pages.joint.ui.service')}</dt>
                                        <dd>{t('pages.joint.connection.' + (connecting ? 'connecting' : state.connection))}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('pages.joint.diagnostics.mod')}</dt>
                                        <dd>{t(state.modReady ? 'pages.joint.diagnostics.modConnected' : 'pages.joint.ui.notConnected')}</dd>
                                    </div>
                                </dl>
                                {room && !state.modReady && <p className={styles.hint}>{t('pages.joint.modRequired')}</p>}
                            </section>
                            {diagnostics && (
                                <ListeningDiagnostics
                                    diagnostics={diagnostics}
                                    queue={room?.queue}
                                    participants={room?.participants}
                                    userId={state.userId}
                                />
                            )}
                        </aside>
                    </div>
                </div>
            </Scrollbar>
        </PageLayout>
    )
}
