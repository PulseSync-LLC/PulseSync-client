import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'
import { MdFolderOpen, MdLinkOff } from 'react-icons/md'

import MetadataEditor from '@pages/extension/route/extBox/MetadataEditor'
import TabNavigation from '@pages/extension/route/extBox/TabNavigation'
import { DESCRIPTION_TAB } from '@pages/extension/route/extBox/types'
import { desktopApi } from '@shared/desktop/desktopApi'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import MarkdownContent from '@shared/ui/PSUI/MarkdownContent'

import AddonMarkdownEditor from './AddonMarkdownEditor'

import * as styles from './AddonProjectEditor.module.scss'

import type { AddonProject, AddonProjectDocument } from '@common/addons/project'
import type { ReactNode } from 'react'
import type { Components } from 'react-markdown'

type DocumentDraft = { content: string; saved: string }
type TextDocument = Exclude<AddonProjectDocument, 'manifest'>

type Props = {
    project: AddonProject
    onResetLink: () => void
    onDirtyChange: (dirty: boolean) => void
    onSavingChange: (saving: boolean) => void
    settingsContent?: ReactNode
}

export default function AddonProjectEditor({ project, onResetLink, onDirtyChange, onSavingChange, settingsContent }: Props) {
    const { t } = useTranslation()
    const [active, setActive] = useState('Metadata')
    const [documents, setDocuments] = useState<Record<TextDocument, DocumentDraft> | null>(null)
    const [metadataDirty, setMetadataDirty] = useState(false)
    const [metadataSaving, setMetadataSaving] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const document: TextDocument = active === DESCRIPTION_TAB ? 'readme' : 'changelog'
    const draft = documents?.[document]
    const dirty = metadataDirty || Object.values(documents ?? {}).some(value => value.content !== value.saved)
    const busy = saving || metadataSaving
    useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
    useEffect(() => onSavingChange(busy), [busy, onSavingChange])
    const loadPreview = useCallback((relativePath: string) => desktopApi.addons.projects.imageDataUrl(project.id, relativePath), [project.id])
    const previewComponents = useMemo<Components>(() => ({ img: props => <ProjectImage {...props} loadPreview={loadPreview} /> }), [loadPreview])
    const renderPreview = useCallback(
        (content: string) => <MarkdownContent components={previewComponents}>{content}</MarkdownContent>,
        [previewComponents],
    )

    useEffect(() => {
        let alive = true
        void Promise.all(['readme', 'changelog'].map(name => desktopApi.addons.projects.readText(project.id, name as TextDocument)))
            .then(([readme, changelog]) => {
                if (alive) setDocuments({ readme: { content: readme, saved: readme }, changelog: { content: changelog, saved: changelog } })
            })
            .catch(() => {
                if (alive) setError(t('metadata.loadError'))
            })
        return () => {
            alive = false
        }
    }, [project.id, t])

    const saveDocument = async () => {
        if (!draft || busy || draft.content === draft.saved) return
        setSaving(true)
        setError('')
        try {
            await desktopApi.addons.projects.writeText(project.id, document, draft.content, draft.saved)
            setDocuments(current => current && { ...current, [document]: { ...current[document], saved: draft.content } })
        } catch (saveError) {
            setError(t(String(saveError).includes('ADDON_PROJECT_CHANGED') ? 'extensions.project.changed' : 'metadata.saveError'))
            return false
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <span className={styles.projectLabel} title={project.rootPath}>
                    <MdFolderOpen size={16} aria-hidden="true" />
                    <span>
                        {t('extensions.project.linkedFolder', { name: project.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? project.rootPath })}
                    </span>
                </span>
                <button
                    type="button"
                    className={styles.resetLink}
                    onClick={onResetLink}
                    disabled={busy}
                    title={t('extensions.project.resetLinkHint')}
                >
                    <MdLinkOff size={15} aria-hidden="true" /> {t('extensions.project.resetLink')}
                </button>
            </div>
            <TabNavigation
                active={active}
                onChange={value => {
                    if (!busy) {
                        setActive(value)
                    }
                }}
                docs={[{ title: t('extensions.tabs.changelog'), value: 'Changelog', content: '', isMarkdown: true }]}
                showMetadataTab
                showSettingsTab={!!settingsContent}
            />
            <div className={styles.content}>
                <div hidden={active !== 'Metadata'}>
                    <MetadataEditor
                        addonPath={project.rootPath}
                        projectId={project.id}
                        onDirtyChange={setMetadataDirty}
                        onSavingChange={setMetadataSaving}
                        addonRelationsEnabled
                    />
                </div>
                {active === 'Settings' && settingsContent}
                {active !== 'Metadata' && active !== 'Settings' && (
                    <div className={styles.document}>
                        {error && <p role="alert">{error}</p>}
                        {!documents ? (
                            <p>{t('extensions.project.loading')}</p>
                        ) : (
                            <AddonMarkdownEditor
                                key={document}
                                label={t(document === 'readme' ? 'extensions.tabs.description' : 'extensions.tabs.changelog')}
                                value={draft?.content ?? ''}
                                disabled={busy}
                                onSave={saveDocument}
                                renderPreview={renderPreview}
                                onChange={content =>
                                    setDocuments(
                                        current =>
                                            current && {
                                                ...current,
                                                [document]: { ...current[document], content },
                                            },
                                    )
                                }
                            />
                        )}
                    </div>
                )}
            </div>
            {active !== 'Metadata' && active !== 'Settings' && (
                <div className={styles.documentChanges}>
                    <ChangesBar
                        open={!!draft && draft.content !== draft.saved}
                        saving={saving}
                        onSave={saveDocument}
                        onReset={() =>
                            setDocuments(
                                current =>
                                    current && {
                                        ...current,
                                        [document]: { ...current[document], content: current[document].saved },
                                    },
                            )
                        }
                    />
                </div>
            )}
        </div>
    )
}

function ProjectImage({ src, alt, loadPreview }: { src?: string | Blob; alt?: string; loadPreview: (file: string) => Promise<string | null> }) {
    const [url, setUrl] = useState<string | null>(null)
    useEffect(() => {
        let alive = true
        setUrl(null)
        if (typeof src === 'string' && !/^(?:[a-z]+:|\/)/i.test(src)) {
            void loadPreview(src)
                .then(value => {
                    if (alive) setUrl(value)
                })
                .catch(() => undefined)
        } else if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
            setUrl(src)
        }
        return () => {
            alive = false
        }
    }, [src, loadPreview])
    return url ? <img src={url} alt={alt ?? ''} /> : null
}
