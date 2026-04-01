import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import path from 'path'
import { MdAdd, MdClose } from 'react-icons/md'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import semver from 'semver'

import TextInput from '@shared/ui/PSUI/TextInput'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import FileInput from '@shared/ui/PSUI/FileInput'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import Loader from '@shared/ui/PSUI/Loader'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import ButtonV2 from '@shared/ui/buttonV2'

import * as css from '@pages/extension/route/extBox/MetadataEditor.module.scss'
import { useTranslation } from 'react-i18next'

type Metadata = {
    name: string
    image: string
    banner: string
    libraryLogo?: string
    author: string
    description: string
    version: string
    css: string
    script: string
    type: 'theme' | 'script' | 'library' | string
    tags: string[]
    dependencies: string[]
    allowedUrls: string[]
    supportedVersions: string[]
}

type MetadataFileShape = Omit<Metadata, 'author'> & {
    author: string | string[]
}

type Props = {
    addonPath: string
    filePreviewSrc?: (rel: string) => string
}

const SEMVER = /^\d+\.\d+\.\d+$/

const DEFAULT_META: Metadata = {
    name: '',
    image: '',
    banner: '',
    libraryLogo: '',
    author: '',
    description: '',
    version: '1.0.0',
    css: 'style.css',
    script: 'script.js',
    type: 'theme',
    tags: [],
    dependencies: [],
    allowedUrls: [],
    supportedVersions: [],
}

function sanitizeFilename(name: string) {
    return name
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
}

async function ensureCopyIntoAddon(addonPath: string, absSourcePath: string, preferredName?: string): Promise<string> {
    const src = path.normalize(absSourcePath)
    const root = path.normalize(addonPath) + path.sep

    if (src.startsWith(root)) {
        return path.relative(addonPath, src).replace(/\\/g, '/')
    }

    const baseName = sanitizeFilename(preferredName || path.basename(src))
    const ext = path.extname(baseName)
    const stem = baseName.slice(0, baseName.length - ext.length)

    const safeExists = async (p: string) => {
        try {
            const res = await window.desktopEvents.invoke(MainEvents.FILE_EVENT, 'exists', p)
            return !!res
        } catch {
            return false
        }
    }

    const MAX_TRIES = 500
    let dest = path.join(addonPath, baseName)
    let i = 1
    while (i <= MAX_TRIES && (await safeExists(dest))) {
        dest = path.join(addonPath, `${stem}_${i++}${ext}`)
    }
    if (i > MAX_TRIES) {
        dest = path.join(addonPath, `${stem}_${Date.now()}${ext}`)
    }

    try {
        await window.desktopEvents.invoke(MainEvents.FILE_EVENT, 'copy-file', src, dest)
    } catch {
        const data: string = await window.desktopEvents.invoke(MainEvents.FILE_EVENT, 'read-file-base64', src)
        await window.desktopEvents.invoke(MainEvents.FILE_EVENT, 'write-file-base64', dest, data)
    }
    return path.basename(dest)
}

function deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (a == null || b == null) return false
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
        return true
    }
    if (typeof a === 'object') {
        const ak = Object.keys(a)
        const bk = Object.keys(b)
        if (ak.length !== bk.length) return false
        for (const k of ak) {
            if (!Object.prototype.hasOwnProperty.call(b, k)) return false
            if (!deepEqual(a[k], b[k])) return false
        }
        return true
    }
    return false
}

function normalizeAuthorInput(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(author => String(author).trim())
            .filter(Boolean)
            .join(', ')
    }

    return typeof value === 'string' ? value : ''
}

function serializeAuthorField(value: string): string | string[] {
    const authors = value
        .split(',')
        .map(author => author.trim())
        .filter(Boolean)

    if (authors.length <= 1) {
        return authors[0] ?? ''
    }

    return authors
}

const MetadataEditor: React.FC<Props> = ({ addonPath }) => {
    const { t } = useTranslation()
    const [draft, setDraft] = useState<Metadata>(DEFAULT_META)
    const baseRef = useRef<Metadata>(DEFAULT_META)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [isListEditorOpen, setIsListEditorOpen] = useState(false)
    const [modalAllowedUrlsDraft, setModalAllowedUrlsDraft] = useState<string[]>([])
    const [modalSupportedVersionsDraft, setModalSupportedVersionsDraft] = useState<string[]>([])
    const [modalAllowedUrlsInput, setModalAllowedUrlsInput] = useState('')
    const [modalSupportedVersionsInput, setModalSupportedVersionsInput] = useState('')

    const open = useMemo(() => !deepEqual(draft, baseRef.current), [draft])
    const valid = useMemo(() => {
        if (!draft.name.trim()) return false
        if (!SEMVER.test(draft.version.trim())) return false
        if (!['theme', 'script', 'library'].includes(draft.type)) return false
        if (draft.supportedVersions.length > 0 && !draft.supportedVersions.every(v => semver.validRange(v))) return false
        return true
    }, [draft])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setError(null)
            setLoading(true)
            try {
                const file = path.join(addonPath, 'metadata.json')
                const raw = await window.desktopEvents.invoke(MainEvents.FILE_EVENT, RendererEvents.READ_FILE, file)
                const parsed = JSON.parse(raw ?? '{}')
                const meta: Metadata = {
                    ...DEFAULT_META,
                    ...parsed,
                    author: normalizeAuthorInput(parsed?.author),
                    tags: Array.isArray(parsed?.tags) ? parsed.tags : [],
                    type: parsed?.type ?? 'theme',
                }
                if (!cancelled) {
                    setDraft(meta)
                    baseRef.current = meta
                }
            } catch (e) {
                console.error(e)
                if (!cancelled) setError(t('metadata.loadError'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [addonPath])

    const setField = useCallback(<K extends keyof Metadata>(key: K, value: Metadata[K]) => {
        setDraft(prev => (prev[key] === value ? prev : { ...prev, [key]: value }))
    }, [])

    const tagsAsString = useMemo(() => draft.tags.join(', '), [draft.tags])
    const setTagsFromString = useCallback(
        (v: string) => {
            const next = v
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            setField('tags', next)
        },
        [setField],
    )

    const dependenciesAsString = useMemo(() => draft.dependencies.join(', '), [draft.dependencies])
    const setDependenciesFromString = useCallback(
        (v: string) => {
            const next = v
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            setField('dependencies', next)
        },
        [setField],
    )

    const parseListEntries = useCallback((value: string) => {
        return value
            .split(/\r?\n/)
            .flatMap(line => line.split(','))
            .map(entry => entry.trim())
            .filter(Boolean)
    }, [])

    const invalidModalSupportedVersions = useMemo(
        () => modalSupportedVersionsDraft.filter(version => !semver.validRange(version)),
        [modalSupportedVersionsDraft],
    )
    const invalidPendingSupportedVersions = useMemo(
        () => parseListEntries(modalSupportedVersionsInput).filter(version => !semver.validRange(version)),
        [modalSupportedVersionsInput, parseListEntries],
    )

    const appendUniqueEntries = useCallback(
        (current: string[], rawValue: string) => {
            const nextEntries = parseListEntries(rawValue)
            if (!nextEntries.length) return current

            const seen = new Set(current.map(entry => entry.toLowerCase()))
            const result = [...current]
            for (const entry of nextEntries) {
                const normalized = entry.toLowerCase()
                if (seen.has(normalized)) continue
                seen.add(normalized)
                result.push(entry)
            }
            return result
        },
        [parseListEntries],
    )

    const openListEditor = useCallback(() => {
        setModalAllowedUrlsDraft(draft.allowedUrls)
        setModalSupportedVersionsDraft(draft.supportedVersions)
        setModalAllowedUrlsInput('')
        setModalSupportedVersionsInput('')
        setIsListEditorOpen(true)
    }, [draft.allowedUrls, draft.supportedVersions])

    const closeListEditor = useCallback(() => {
        setIsListEditorOpen(false)
    }, [])

    const addAllowedUrls = useCallback(() => {
        setModalAllowedUrlsDraft(prev => appendUniqueEntries(prev, modalAllowedUrlsInput))
        setModalAllowedUrlsInput('')
    }, [appendUniqueEntries, modalAllowedUrlsInput])

    const addSupportedVersions = useCallback(() => {
        const entries = parseListEntries(modalSupportedVersionsInput)
        if (!entries.length) return
        if (entries.some(version => !semver.validRange(version))) return

        setModalSupportedVersionsDraft(prev => appendUniqueEntries(prev, modalSupportedVersionsInput))
        setModalSupportedVersionsInput('')
    }, [appendUniqueEntries, modalSupportedVersionsInput, parseListEntries])

    const removeAllowedUrl = useCallback((value: string) => {
        setModalAllowedUrlsDraft(prev => prev.filter(entry => entry !== value))
    }, [])

    const removeSupportedVersion = useCallback((value: string) => {
        setModalSupportedVersionsDraft(prev => prev.filter(entry => entry !== value))
    }, [])

    const applyListEditor = useCallback(() => {
        if (invalidModalSupportedVersions.length > 0) return

        setField('allowedUrls', modalAllowedUrlsDraft)
        setField('supportedVersions', modalSupportedVersionsDraft)
        setIsListEditorOpen(false)
    }, [invalidModalSupportedVersions.length, modalAllowedUrlsDraft, modalSupportedVersionsDraft, setField])

    const resolveRelIfNeeded = useCallback(
        async (value: string, fallbackBase: string, fallbackExt: string) => {
            if (!value) return value
            if (path.isAbsolute(value)) {
                const rel = await ensureCopyIntoAddon(addonPath, value, fallbackBase + path.extname(value || fallbackExt))
                return rel
            }
            return value
        },
        [addonPath],
    )

    const onSave = useCallback(async () => {
        if (!open || !valid || saving) return
        setSaving(true)
        setError(null)
        try {
            const next: Metadata = { ...draft }

            if (draft.image) next.image = await resolveRelIfNeeded(draft.image, 'image', '.png')
            if (draft.banner) next.banner = await resolveRelIfNeeded(draft.banner, 'banner', '.png')
            if (draft.libraryLogo) next.libraryLogo = await resolveRelIfNeeded(draft.libraryLogo, 'libraryLogo', '.png')
            if (draft.css) next.css = await resolveRelIfNeeded(draft.css, 'style', '.css')
            if (draft.script) next.script = await resolveRelIfNeeded(draft.script, 'script', '.js')

            const metadataToSave: MetadataFileShape = {
                ...next,
                author: serializeAuthorField(next.author),
            }

            const file = path.join(addonPath, 'metadata.json')
            await window.desktopEvents.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, file, JSON.stringify(metadataToSave, null, 2))

            baseRef.current = next
            setDraft(next)
        } catch (e) {
            console.error(e)
            setError(t('metadata.saveError'))
        } finally {
            setSaving(false)
        }
    }, [addonPath, draft, open, resolveRelIfNeeded, saving, valid])

    const onReset = useCallback(() => {
        setDraft(baseRef.current)
    }, [])

    if (loading)
        return (
            <div className={css.alert}>
                <Loader variant="panel" />
            </div>
        )
    if (error) return <div className={css.alert}>{error}</div>

    return (
        <div className={css.root}>
            <div className={css.metaGrid}>
                <div className={`${css.metaWide} ${css.metaSplit}`}>
                    <div className={css.metaMainColumn}>
                        <TextInput name="meta-name" label={t('metadata.labels.name')} value={draft.name} onChange={v => setField('name', v)} />
                        <TextInput
                            name="meta-description"
                            label={t('metadata.labels.description')}
                            value={draft.description}
                            onChange={v => setField('description', v)}
                            className={css.metaDescription}
                        />
                    </div>

                    <div className={css.metaSideColumn}>
                        <TextInput
                            name="meta-author"
                            label={t('metadata.labels.author')}
                            value={draft.author}
                            onChange={v => setField('author', v)}
                        />

                        <div className={css.metaSideRow}>
                            <SelectInput
                                label={t('metadata.labels.type')}
                                value={draft.type}
                                options={[
                                    { value: 'theme', label: 'theme' },
                                    { value: 'script', label: 'script' },
                                    { value: 'library', label: 'library' },
                                ]}
                                onChange={v => setField('type', v as Metadata['type'])}
                            />

                            <TextInput
                                name="meta-version"
                                label={t('metadata.labels.version')}
                                value={draft.version}
                                onChange={v => setField('version', v)}
                                description={!SEMVER.test(draft.version) ? t('metadata.versionFormat') : undefined}
                            />
                        </div>
                    </div>
                </div>

                <TextInput
                    name="meta-tags"
                    label={t('metadata.labels.tags')}
                    value={tagsAsString}
                    onChange={setTagsFromString}
                    className={css.metaWide}
                    description={t('metadata.examples.tags')}
                />

                <div className={`${css.metaWide} ${css.assetGrid}`}>
                    <div className={css.fileCol}>
                        <FileInput
                            label={t('metadata.labels.image')}
                            value={draft.image}
                            onChange={p => setField('image', p)}
                            placeholder={t('metadata.placeholders.selectOrEnterPath')}
                            metadata
                            addonPath={addonPath}
                            preferredBaseName="image"
                            accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
                        />
                    </div>

                    <div className={css.fileCol}>
                        <FileInput
                            label={t('metadata.labels.banner')}
                            value={draft.banner}
                            onChange={p => setField('banner', p)}
                            placeholder={t('metadata.placeholders.selectOrEnterPath')}
                            metadata
                            addonPath={addonPath}
                            preferredBaseName="banner"
                            accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
                        />
                    </div>

                    <div className={css.fileCol}>
                        <FileInput
                            label={t('metadata.labels.libraryLogo')}
                            value={draft.libraryLogo ?? ''}
                            onChange={p => setField('libraryLogo', p)}
                            placeholder={t('metadata.placeholders.logoFile')}
                            metadata
                            addonPath={addonPath}
                            preferredBaseName="libraryLogo"
                            accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
                        />
                    </div>

                    <FileInput
                        label={t('metadata.labels.css')}
                        value={draft.css}
                        onChange={p => setField('css', p)}
                        placeholder={t('metadata.placeholders.cssPath')}
                        metadata
                        addonPath={addonPath}
                        preferredBaseName="style"
                        accept=".css"
                    />

                    <FileInput
                        className={css.assetWide}
                        label={t('metadata.labels.script')}
                        value={draft.script}
                        onChange={p => setField('script', p)}
                        placeholder={t('metadata.placeholders.scriptPath')}
                        metadata
                        addonPath={addonPath}
                        preferredBaseName="script"
                        accept=".js"
                    />
                </div>

                <div className={css.listEditorCard}>
                    <div className={css.listEditorHeader}>
                        <div>
                            <div className={css.listEditorTitle}>{t('metadata.listEditor.title')}</div>
                            <div className={css.listEditorDescription}>{t('metadata.listEditor.description')}</div>
                        </div>
                        <button type="button" className={css.listEditorButton} onClick={openListEditor}>
                            {t('metadata.listEditor.edit')}
                        </button>
                    </div>

                    <div className={css.listSummaryRow}>
                        <div className={css.listSummaryMeta}>
                            <div className={css.listSummaryLabel}>{t('metadata.labels.allowedUrls')}</div>
                            <div className={css.listSummaryValue}>
                                {draft.allowedUrls.length
                                    ? t('metadata.listEditor.allowedUrlsSummary', { count: draft.allowedUrls.length })
                                    : t('metadata.listEditor.previewEmpty')}
                            </div>
                        </div>

                        <div className={css.listSummaryMeta}>
                            <div className={css.listSummaryLabel}>{t('metadata.labels.supportedVersions')}</div>
                            <div className={css.listSummaryValue}>
                                {draft.supportedVersions.length
                                    ? t('metadata.listEditor.supportedVersionsSummary', {
                                          value: draft.supportedVersions.join(', '),
                                      })
                                    : t('metadata.listEditor.previewEmpty')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <CustomModalPS
                className={css.listEditorModal}
                isOpen={isListEditorOpen}
                onClose={closeListEditor}
                title={t('metadata.listEditor.title')}
                text={t('metadata.listEditor.description')}
                buttons={[
                    {
                        text: t('common.cancel'),
                        onClick: closeListEditor,
                        variant: 'secondary',
                    },
                    {
                        text: t('common.done'),
                        onClick: applyListEditor,
                        disabled: invalidModalSupportedVersions.length > 0,
                    },
                ]}
            >
                <div className={css.listEditorModalBody}>
                    <div className={css.listEditorSection}>
                        <div className={css.listEditorSectionHeader}>
                            <div className={css.listEditorFieldLabel}>{t('metadata.listEditor.allowedUrlsTitle')}</div>
                            <div className={css.listEditorHint}>{t('metadata.listEditor.allowedUrlsHint')}</div>
                        </div>

                        <div className={css.listEditorComposer}>
                            <input
                                className={css.listEditorInput}
                                value={modalAllowedUrlsInput}
                                onChange={event => setModalAllowedUrlsInput(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault()
                                        addAllowedUrls()
                                    }
                                }}
                                placeholder={t('metadata.examples.allowedUrls')}
                            />
                            <ButtonV2
                                className={css.listEditorAddButton}
                                onClick={addAllowedUrls}
                                disabled={!parseListEntries(modalAllowedUrlsInput).length}
                            >
                                <MdAdd size={18} />
                                <span>{t('metadata.listEditor.add')}</span>
                            </ButtonV2>
                        </div>

                        {modalAllowedUrlsDraft.length ? (
                            <div className={css.listEditorItems}>
                                {modalAllowedUrlsDraft.map(url => (
                                    <div key={url} className={css.listEditorRow}>
                                        <div className={css.listEditorRowValue}>{url}</div>
                                        <button type="button" className={css.listEditorRemoveButton} onClick={() => removeAllowedUrl(url)}>
                                            <MdClose size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={css.listEditorEmpty}>{t('metadata.listEditor.previewEmpty')}</div>
                        )}
                    </div>

                    <div className={css.listEditorSection}>
                        <div className={css.listEditorSectionHeader}>
                            <div className={css.listEditorFieldLabel}>{t('metadata.listEditor.supportedVersionsTitle')}</div>
                            <div className={css.listEditorHint}>{t('metadata.listEditor.supportedVersionsHint')}</div>
                        </div>

                        <div className={css.listEditorComposer}>
                            <input
                                className={css.listEditorInput}
                                value={modalSupportedVersionsInput}
                                onChange={event => setModalSupportedVersionsInput(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault()
                                        addSupportedVersions()
                                    }
                                }}
                                placeholder={t('metadata.examples.supportedVersions')}
                            />
                            <ButtonV2
                                className={css.listEditorAddButton}
                                onClick={addSupportedVersions}
                                disabled={!parseListEntries(modalSupportedVersionsInput).length || invalidPendingSupportedVersions.length > 0}
                            >
                                <MdAdd size={18} />
                                <span>{t('metadata.listEditor.add')}</span>
                            </ButtonV2>
                        </div>

                        {invalidPendingSupportedVersions.length > 0 && (
                            <div className={css.listEditorInlineError}>
                                {t('metadata.listEditor.invalidSupportedVersions', {
                                    versions: invalidPendingSupportedVersions.join(', '),
                                })}
                            </div>
                        )}

                        {modalSupportedVersionsDraft.length ? (
                            <div className={css.listEditorItems}>
                                {modalSupportedVersionsDraft.map(version => (
                                    <div key={version} className={css.listEditorRow}>
                                        <div className={css.listEditorRowValue}>{version}</div>
                                        <button type="button" className={css.listEditorRemoveButton} onClick={() => removeSupportedVersion(version)}>
                                            <MdClose size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={css.listEditorEmpty}>{t('metadata.listEditor.previewEmpty')}</div>
                        )}
                    </div>
                </div>

                {invalidModalSupportedVersions.length > 0 && (
                    <div className={css.listEditorError}>
                        {t('metadata.listEditor.invalidSupportedVersions', {
                            versions: invalidModalSupportedVersions.join(', '),
                        })}
                    </div>
                )}
            </CustomModalPS>

            <ChangesBar
                open={open}
                saving={saving}
                text={valid ? t('changes.unsavedWarning') : t('metadata.fixErrors')}
                onSave={onSave}
                onReset={onReset}
                disabledSave={!valid}
            />
            <div className={css.footerSpace} />
        </div>
    )
}

export default MetadataEditor
