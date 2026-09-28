import React from 'react'

import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import Loader from '@shared/ui/PSUI/Loader'
import Modal from '@shared/ui/PSUI/Modal'

import * as modalStyles from '@shared/ui/PSUI/Modal/modal.module.scss'

import type { Components } from 'react-markdown'

export type ModChangelogEntry = {
    id: string
    version: string
    createdAt: number
    description: string | string[]
}

export type AppPatchNote = {
    id: string
    title: string
    version?: string
    changelog: string
    createdAt: number
}

type Props = {
    appError: string | null
    appUpdatesInfo: AppPatchNote[]
    closeModModal: () => void
    closeAppChangelogModal: () => void
    formatDate: (timestamp: any) => string
    isAppChangelogModalOpen: boolean
    isModModalOpen: boolean
    loadingAppUpdates: boolean
    loadingModChanges: boolean
    modChangesInfo: ModChangelogEntry[]
    modError?: string | null
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
                    {loadingAppUpdates && <Loader variant="modChangelog" />}
                    {appError && <p>{t('header.errorWithMessage', { message: appError })}</p>}
                    {!loadingAppUpdates &&
                        !appError &&
                        appUpdatesInfo.map(info => (
                            <div key={info.id} className={modalStyles.updateItem}>
                                <div className={modalStyles.version_info}>
                                    <h3>{info.title}</h3>
                                    <span>{formatDate(info.createdAt)}</span>
                                </div>
                                <div className={modalStyles.remerkStyle}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: LinkRenderer }}>
                                        {info.changelog}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        ))}
                    {!loadingAppUpdates && !appError && appUpdatesInfo.length === 0 && <p>{t('header.noChangelogFound')}</p>}
                </div>
            </Modal>
            <Modal title={t('header.latestModUpdatesTitle')} isOpen={isModModalOpen} reqClose={closeModModal}>
                <div className={modalStyles.updateModal}>
                    {loadingModChanges && <Loader variant="modChangelog" />}
                    {modError && <p>{t('header.errorWithMessage', { message: modError })}</p>}
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
