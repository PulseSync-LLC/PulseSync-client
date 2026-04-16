import React, { useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { compareVersions } from '@shared/lib/utils'
import Modal from '@shared/ui/PSUI/Modal'
import Loader from '@shared/ui/PSUI/Loader'
import * as modalStyles from '@shared/ui/PSUI/Modal/modal.module.scss'
import * as styles from './YandexMusicChangelogModal.module.scss'

const RELEASE_NOTES_URL = 'https://desktop.app.music.yandex.net/stable/release-notes/ru.json'
const RELEASE_NOTES_DEFAULT_KEY = 'desktop-release-notes.default'

type ReleaseNotesNode = {
    type: number
    value: string
    children?: ReleaseNotesNode[]
}

type ReleaseNotesResponse = Record<string, ReleaseNotesNode[]>

type ReleaseNotesEntry = {
    date: string | null
    versionLabel: string
    versionValue: string
    isDefault: boolean
    nodes: ReleaseNotesNode[]
}

function normalizeVersion(version: string | null | undefined): string | null {
    const match = String(version ?? '')
        .trim()
        .match(/\d+\.\d+\.\d+/)

    return match?.[0] ?? null
}

function flattenNodeText(nodes: ReleaseNotesNode[] = []): string {
    return nodes
        .map(node => {
            if (node.type === 0) return node.value
            if (node.type === 1 && node.value === 'br') return '\n'
            if (node.children?.length) return flattenNodeText(node.children)
            return ''
        })
        .join('')
        .trim()
}

function buildReleaseNotesEntries(data: ReleaseNotesResponse | null, fallbackVersionLabel: string): ReleaseNotesEntry[] {
    if (!data) return []

    const entries = Object.entries(data)
        .filter(([, nodes]) => Array.isArray(nodes) && nodes.length > 0)
        .map(([key, nodes]) => {
            const rawVersion = key.replace('desktop-release-notes.', '')
            const isDefault = key === RELEASE_NOTES_DEFAULT_KEY
            const dateNode = nodes.find(node => node.type === 8 && node.value === 'date')
            const normalizedVersion = normalizeVersion(rawVersion)

            return {
                date: dateNode?.children?.length ? flattenNodeText(dateNode.children) : null,
                versionLabel: isDefault ? fallbackVersionLabel : rawVersion,
                versionValue: normalizedVersion ?? rawVersion,
                isDefault,
                nodes: nodes.filter(node => !(node.type === 8 && node.value === 'date')),
            }
        })

    return entries.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return 1
        if (!a.isDefault && b.isDefault) return -1
        return compareVersions(b.versionValue, a.versionValue)
    })
}

function applyCurrentVersionFallback(entries: ReleaseNotesEntry[], currentVersion: string | null): ReleaseNotesEntry[] {
    const normalizedCurrentVersion = normalizeVersion(currentVersion)

    if (!normalizedCurrentVersion) {
        return entries
    }

    const hasCurrentVersionEntry = entries.some(entry => !entry.isDefault && normalizeVersion(entry.versionValue) === normalizedCurrentVersion)

    if (hasCurrentVersionEntry) {
        return entries
    }

    const defaultEntry = entries.find(entry => entry.isDefault)

    if (!defaultEntry) {
        return entries
    }

    return [
        {
            ...defaultEntry,
            versionLabel: normalizedCurrentVersion,
            versionValue: normalizedCurrentVersion,
            isDefault: false,
        },
        ...entries.filter(entry => !entry.isDefault),
    ]
}

function renderReleaseNotesNodes(nodes: ReleaseNotesNode[], keyPrefix = 'root'): React.ReactNode[] {
    return nodes.map((node, index) => {
        const key = `${keyPrefix}-${index}`

        if (node.type === 0) {
            return node.value
        }

        if (node.type === 1 && node.value === 'br') {
            return <br key={key} />
        }

        if (node.type !== 8) {
            return null
        }

        if (node.value === 'date') {
            return null
        }

        const children = renderReleaseNotesNodes(node.children || [], key)

        if (node.value === 'ul') {
            return <ul key={key}>{children}</ul>
        }

        if (node.value === 'li') {
            return <li key={key}>{children}</li>
        }

        if (node.value === 'p') {
            return <p key={key}>{children}</p>
        }

        return <span key={key}>{children}</span>
    })
}

const YandexMusicChangelogModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, getModalState, isModalOpen } = useModalContext()
    const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesResponse | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isOpen = isModalOpen(Modals.YANDEX_MUSIC_CHANGELOG)
    const { currentVersion } = getModalState(Modals.YANDEX_MUSIC_CHANGELOG)

    useEffect(() => {
        if (!isOpen) return

        const controller = new AbortController()

        setIsLoading(true)
        setError(null)

        fetch(RELEASE_NOTES_URL, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                return (await response.json()) as ReleaseNotesResponse
            })
            .then(data => {
                setReleaseNotes(data)
            })
            .catch(fetchError => {
                if (controller.signal.aborted) {
                    return
                }

                setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false)
                }
            })

        return () => {
            controller.abort()
        }
    }, [isOpen])

    const releaseNotesEntries = useMemo(() => {
        const entries = buildReleaseNotesEntries(releaseNotes, t('pages.home.musicReleaseNotesFallbackVersion'))
        return applyCurrentVersionFallback(entries, currentVersion ?? null)
    }, [currentVersion, releaseNotes, t])

    return (
        <Modal
            title={t('pages.home.musicReleaseNotesTitle')}
            isOpen={isOpen}
            reqClose={() => closeModal(Modals.YANDEX_MUSIC_CHANGELOG)}
        >
            <div className={modalStyles.updateModal}>
                {isLoading && <Loader variant="panel" />}
                {!isLoading && error && <p>{t('header.errorWithMessage', { message: error })}</p>}
                {!isLoading &&
                    !error &&
                    releaseNotesEntries.map(entry => (
                        <div key={entry.versionLabel} className={`${modalStyles.updateItem} ${styles.updateItem}`}>
                            <div className={`${modalStyles.version_info} ${styles.versionInfo}`}>
                                <h3>{entry.versionLabel}</h3>
                                {entry.date && <span>{entry.date}</span>}
                            </div>
                            <div className={`${modalStyles.remerkStyle} ${styles.content}`}>{renderReleaseNotesNodes(entry.nodes, entry.versionLabel)}</div>
                        </div>
                    ))}
                {!isLoading && !error && releaseNotesEntries.length === 0 && <p>{t('header.noChangelogFound')}</p>}
            </div>
        </Modal>
    )
}

export default YandexMusicChangelogModal
