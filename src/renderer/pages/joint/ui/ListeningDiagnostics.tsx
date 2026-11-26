import { Accordion } from '@pulsesync/uikit/layout'
import { useTranslation } from 'react-i18next'

import * as styles from '../joint.module.scss'

import type { ListeningRoom, ListeningView } from '@common/listening/types'

interface Props {
    diagnostics: NonNullable<ListeningView['diagnostics']>
    queue?: ListeningRoom['queue']
}

export default function ListeningDiagnostics({ diagnostics, queue }: Props) {
    const { t } = useTranslation()
    const milliseconds = (value: number | null) =>
        value === null ? t('pages.joint.diagnostics.unknown') : `${value} ${t('pages.joint.diagnostics.ms')}`
    const age = (value: number | null) =>
        value === null ? t('pages.joint.diagnostics.unknown') : t('pages.joint.diagnostics.seconds', { count: Math.ceil(value / 1000) })

    return (
        <Accordion
            sectionClassName={styles.diagnosticsPanel}
            headerClassName={styles.diagnosticsHeader}
            bodyClassName={styles.diagnosticsBody}
            showDivider={false}
            numbered={false}
            defaultOpen={[]}
            items={[
                {
                    key: 'connection',
                    title: <span className={styles.diagnosticsTitle}>{t('pages.joint.diagnostics.title')}</span>,
                    content: (
                        <dl className={styles.diagnosticValues}>
                            <div>
                                <dt>{t('pages.joint.diagnostics.rtt')}</dt>
                                <dd>{milliseconds(diagnostics.rttMs)}</dd>
                            </div>
                            <div>
                                <dt>{t('pages.joint.diagnostics.clock')}</dt>
                                <dd>
                                    {diagnostics.clockUncertaintyMs === null
                                        ? t('pages.joint.diagnostics.unknown')
                                        : `±${milliseconds(diagnostics.clockUncertaintyMs)}`}
                                </dd>
                            </div>
                            <div>
                                <dt>{t('pages.joint.diagnostics.snapshot')}</dt>
                                <dd>{age(diagnostics.snapshotAgeMs)}</dd>
                            </div>
                            <div>
                                <dt>{t('pages.joint.diagnostics.source')}</dt>
                                <dd>{age(diagnostics.sourceAgeMs)}</dd>
                            </div>
                            {queue && (
                                <>
                                    <div>
                                        <dt>{t('pages.joint.diagnostics.queue')}</dt>
                                        <dd>
                                            {queue.items.length} ·{' '}
                                            {t(queue.shuffle ? 'pages.joint.diagnostics.shuffleOn' : 'pages.joint.diagnostics.shuffleOff')} ·{' '}
                                            {t(`pages.joint.repeat.${queue.repeatMode ?? 'none'}`)}
                                        </dd>
                                    </div>
                                </>
                            )}
                            {diagnostics.lastDisconnectReason && (
                                <>
                                    <div>
                                        <dt>{t('pages.joint.diagnostics.disconnect')}</dt>
                                        <dd>
                                            {t(`pages.joint.errors.${diagnostics.lastDisconnectReason}`, {
                                                defaultValue: diagnostics.lastDisconnectReason,
                                            })}
                                        </dd>
                                    </div>
                                </>
                            )}
                            {diagnostics.sourceError && (
                                <>
                                    <div>
                                        <dt>{t('pages.joint.diagnostics.sourceError')}</dt>
                                        <dd>
                                            {t(`pages.joint.errors.${diagnostics.sourceError}`, {
                                                defaultValue: t('pages.joint.errors.PLAYBACK_FAILED'),
                                            })}
                                        </dd>
                                    </div>
                                </>
                            )}
                        </dl>
                    ),
                },
            ]}
        />
    )
}
