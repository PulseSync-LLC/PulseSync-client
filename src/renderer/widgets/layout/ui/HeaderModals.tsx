import React from 'react'
import Modal from '@shared/ui/PSUI/Modal'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import * as modalStyles from '@shared/ui/PSUI/Modal/modal.module.scss'
import Loader from '@shared/ui/PSUI/Loader'
import Shimmer from '@shared/ui/PSUI/Shimmer'
import { useTranslation } from 'react-i18next'
import { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'

export type ModChangelogEntry = {
    id: string
    version: string
    createdAt: number
    description: string | string[]
}

type Props = {
    appError: string | null
    appUpdatesInfo: AppInfoInterface[]
    appVersion: string
    closeModModal: () => void
    closeAppChangelogModal: () => void
    formatDate: (timestamp: any) => string
    isAppChangelogModalOpen: boolean
    isModModalOpen: boolean
    loadingAppUpdates: boolean
    loadingModChanges: boolean
    modChangesInfo: ModChangelogEntry[]
    modError?: Error
}

const LinkRenderer: Components['a'] = props => {
    return (
        <a href={props.href} target="_blank" rel="noreferrer">
            {props.children}
        </a>
    )
}

const UpdateLinkRenderer: Components['a'] = ({ href, children }) => {
    return (
        <a href={href ?? '#'} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    )
}

export default function HeaderModals({
    appError,
    appUpdatesInfo,
    appVersion,
    closeModModal,
    closeAppChangelogModal,
    formatDate,
    isAppChangelogModalOpen,
    isModModalOpen,
    loadingAppUpdates,
    loadingModChanges,
    modChangesInfo,
    modError,
}: Props) {
    const { t } = useTranslation()

    return (
        <>
            <Modal title={t('header.latestUpdatesTitle')} isOpen={isAppChangelogModalOpen} reqClose={closeAppChangelogModal}>
                <div className={modalStyles.updateModal}>
                    {loadingAppUpdates && <Loader variant="panel" />}
                    {appError && <p>{t('header.errorWithMessage', { message: appError })}</p>}
                    {!loadingAppUpdates &&
                        !appError &&
                        appUpdatesInfo
                            .filter(info => info.version <= appVersion)
                            .map(info => (
                                <div key={info.id} className={modalStyles.updateItem}>
                                    <div className={modalStyles.version_info}>
                                        <h3>{info.version}</h3>
                                        <span>{formatDate(info.createdAt)}</span>
                                    </div>
                                    <div className={modalStyles.remerkStyle}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: LinkRenderer }}>
                                            {info.changelog}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            ))}
                    {!loadingAppUpdates && !appError && appUpdatesInfo.filter(info => info.version <= appVersion).length === 0 && (
                        <p>{t('header.noChangelogFound')}</p>
                    )}
                </div>
            </Modal>
            <Modal title={t('header.latestModUpdatesTitle')} isOpen={isModModalOpen} reqClose={closeModModal}>
                <div className={modalStyles.updateModal}>
                    {modError && <p>{t('header.errorWithMessage', { message: modError.message })}</p>}
                    {!loadingModChanges &&
                        !modError &&
                        modChangesInfo.length > 0 &&
                        modChangesInfo.map(info => (
                            <div key={info.id} className={modalStyles.updateItem}>
                                <div className={modalStyles.version_info}>
                                    <h3>{info.version}</h3>
                                    <span>{formatDate(info.createdAt)}</span>
                                </div>
                                <div className={modalStyles.remerkStyle}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: UpdateLinkRenderer }}>
                                        {Array.isArray(info.description) ? info.description.join('\n') : info.description || ''}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        ))}
                    {!loadingModChanges && !modError && modChangesInfo.length === 0 && <p>{t('header.noChangelogFound')}</p>}
                </div>
            </Modal>
        </>
    )
}
