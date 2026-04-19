import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import path from 'path'
import { MdAdd, MdClose } from 'react-icons/md'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import semver from 'semver'

import TextInput from '@shared/ui/PSUI/TextInput'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import FileInput from '@shared/ui/PSUI/FileInput'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import ButtonV2 from '@shared/ui/buttonV2'
import UserContext from '@entities/user/model/context'
import type { StoreAddon, StoreAddonsPayload } from '@entities/addon/model/storeAddon.interface'
import apolloClient from '@shared/api/apolloClient'
import GetStoreAddonsQuery from '@entities/addon/api/getStoreAddons.query'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'

import * as css from '@pages/extension/route/extBox/MetadataEditor.module.scss'
import { useTranslation } from 'react-i18next'

type Metadata = {
    id?: string
    storeAddonId?: string
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
    conflictsWith: string[]
    allowedUrls: string[]
    supportedVersions: string[]
}

type MetadataFileShape = Omit<Metadata, 'author'> & {
    author: string | string[]
}

type Props = {
    addonPath: string
    addonRelationsEnabled?: boolean
    filePreviewSrc?: (rel: string) => string
}

type StoreAddonsQuery = {
    getStoreAddons: StoreAddonsPayload
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
    conflictsWith: [],
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

    const safeExists = async (filePath: string) => {
        try {
            const res = await window.desktopEvents.invoke(MainEvents.FILE_EVENT, 'exists', filePath)
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

const MetadataSkeleton: React.FC = () => (
    <div className={css.root}>
        <div className={css.metaGrid}>
            <div className={`${css.metaWide} ${css.metaSplit}`}>
                <div className={css.metaMainColumn}>
                    <div className={css.skeletonFieldLarge} />
                    <div className={css.skeletonFieldTall} />
                </div>

                <div className={css.metaSideColumn}>
                    <div className={css.skeletonFieldLarge} />
                    <div className={css.metaSideRow}>
                        <div className={css.skeletonFieldMedium} />
                        <div className={css.skeletonFieldMedium} />
                    </div>
                </div>
            </div>

            <div className={`${css.metaWide} ${css.skeletonFieldLarge}`} />

            <div className={`${css.metaWide} ${css.assetGrid}`}>
                <div className={css.skeletonCard} />
                <div className={css.skeletonCard} />
                <div className={css.skeletonCard} />
                <div className={css.skeletonCard} />
                <div className={`${css.assetWide} ${css.skeletonCard}`} />
            </div>
        </div>
    </div>
)

const MetadataEditor: React.FC<Props> = ({ addonPath, addonRelationsEnabled }) => {
    const { t } = useTranslation()
    const { setAddons } = useContext(UserContext)
    const { isExperimentEnabled } = useExperiments()
    const relationsEnabled = addonRelationsEnabled ?? isExperimentEnabled(CLIENT_EXPERIMENTS.ClientAddonRelations, false)
    const [draft, setDraft] = useState<Metadata>(DEFAULT_META)
    const baseRef = useRef<Metadata>(DEFAULT_META)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const [isRelationsEditorOpen, setIsRelationsEditorOpen] = useState(false)
    const [isCompatibilityEditorOpen, setIsCompatibilityEditorOpen] = useState(false)

    const [availableAddons, setAvailableAddons] = useState<StoreAddon[]>([])
    const [modalDependenciesDraft, setModalDependenciesDraft] = useState<string[]>([])
    const [modalConflictsDraft, setModalConflictsDraft] = useState<string[]>([])
    const [modalAllowedUrlsDraft, setModalAllowedUrlsDraft] = useState<string[]>([])
    const [modalSupportedVersionsDraft, setModalSupportedVersionsDraft] = useState<string[]>([])

    const [modalDependencySelection, setModalDependencySelection] = useState('')
    const [modalConflictSelection, setModalConflictSelection] = useState('')
    const [modalAllowedUrlsInput, setModalAllowedUrlsInput] = useState('')
    const [modalSupportedVersionsInput, setModalSupportedVersionsInput] = useState('')

    const open = useMemo(() => !deepEqual(draft, baseRef.current), [draft])
    const valid = useMemo(() => {
        if (!draft.name.trim()) return false
        if (!SEMVER.test(draft.version.trim())) return false
        if (!['theme', 'script', 'library'].includes(draft.type)) return false
        if (draft.supportedVersions.length > 0 && !draft.supportedVersions.every(version => semver.validRange(version))) return false
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
                    dependencies: Array.isArray(parsed?.dependencies) ? parsed.dependencies : [],
                    conflictsWith: Array.isArray(parsed?.conflictsWith) ? parsed.conflictsWith : [],
                    allowedUrls: Array.isArray(parsed?.allowedUrls) ? parsed.allowedUrls : [],
                    supportedVersions: Array.isArray(parsed?.supportedVersions) ? parsed.supportedVersions : [],
                    type: parsed?.type ?? 'theme',
                }
                if (!cancelled) {
                    setDraft(meta)
                    baseRef.current = meta
                }
            } catch (loadMetadataError) {
                console.error(loadMetadataError)
                if (!cancelled) setError(t('metadata.loadError'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [addonPath, t])

    useEffect(() => {
        if (!relationsEnabled) {
            setAvailableAddons([])
            return
        }

        let cancelled = false

        ;(async () => {
            try {
                const response = await apolloClient.query<StoreAddonsQuery>({
                    query: GetStoreAddonsQuery,
                    variables: {
                        page: 1,
                        pageSize: 500,
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!cancelled) {
                    setAvailableAddons(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
                }
            } catch (loadAddonsError) {
                console.error('[MetadataEditor] failed to load store catalog for relation selectors', loadAddonsError)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [relationsEnabled])

    const setField = useCallback(<K extends keyof Metadata>(key: K, value: Metadata[K]) => {
        setDraft(prev => (prev[key] === value ? prev : { ...prev, [key]: value }))
    }, [])

    const tagsAsString = useMemo(() => draft.tags.join(', '), [draft.tags])
    const setTagsFromString = useCallback(
        (value: string) => {
            const next = value
                .split(',')
                .map(entry => entry.trim())
                .filter(Boolean)
            setField('tags', next)
        },
        [setField],
    )

    const relationOptionRecords = useMemo(() => {
        const relationCandidates = availableAddons
            .filter(addon => addon.name !== 'Default')
            .filter(addon => !(draft.storeAddonId && addon.id === draft.storeAddonId))
            .filter(addon => !(draft.id && addon.id === draft.id))

        const normalizedNameCounts = relationCandidates.reduce(
            (acc, addon) => {
                const key = addon.name.trim().toLowerCase()
                acc.set(key, (acc.get(key) || 0) + 1)
                return acc
            },
            new Map<string, number>(),
        )

        return relationCandidates
            .map(addon => {
                const normalizedName = addon.name.trim().toLowerCase()
                const hasDuplicateName = (normalizedNameCounts.get(normalizedName) || 0) > 1
                const suffixParts = [
                    hasDuplicateName ? addon.type : '',
                    addon.currentRelease?.version?.trim() || '',
                ].filter(Boolean)
                const label = suffixParts.length ? `${addon.name} (${suffixParts.join(' • ')})` : addon.name

                return {
                    value: addon.id,
                    label,
                    searchText: addon.name,
                }
            })
            .sort((left, right) => left.label.localeCompare(right.label))
    }, [availableAddons, draft.id, draft.storeAddonId])

    const relationOptions = useMemo(() => relationOptionRecords.map(({ value, label, searchText }) => ({ value, label, searchText })), [relationOptionRecords])

    const relationLabelMap = useMemo(() => {
        const entries = new Map<string, string>()
        relationOptions.forEach(option => entries.set(String(option.value), option.label))
        return entries
    }, [relationOptions])

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

    const openRelationsEditor = useCallback(() => {
        setModalDependenciesDraft(draft.dependencies)
        setModalConflictsDraft(draft.conflictsWith)
        setModalDependencySelection('')
        setModalConflictSelection('')
        setIsRelationsEditorOpen(true)
    }, [draft.conflictsWith, draft.dependencies])

    const closeRelationsEditor = useCallback(() => {
        setIsRelationsEditorOpen(false)
    }, [])

    const openCompatibilityEditor = useCallback(() => {
        setModalAllowedUrlsDraft(draft.allowedUrls)
        setModalSupportedVersionsDraft(draft.supportedVersions)
        setModalAllowedUrlsInput('')
        setModalSupportedVersionsInput('')
        setIsCompatibilityEditorOpen(true)
    }, [draft.allowedUrls, draft.supportedVersions])

    const closeCompatibilityEditor = useCallback(() => {
        setIsCompatibilityEditorOpen(false)
    }, [])

    const addRelation = useCallback((selection: string, setter: React.Dispatch<React.SetStateAction<string[]>>, reset: () => void) => {
        const nextRelation = selection.trim()
        if (!nextRelation) return

        setter(prev => {
            if (prev.includes(nextRelation)) return prev
            return [...prev, nextRelation]
        })
        reset()
    }, [])

    const addDependency = useCallback(() => {
        addRelation(modalDependencySelection, setModalDependenciesDraft, () => setModalDependencySelection(''))
    }, [addRelation, modalDependencySelection])

    const addConflict = useCallback(() => {
        addRelation(modalConflictSelection, setModalConflictsDraft, () => setModalConflictSelection(''))
    }, [addRelation, modalConflictSelection])

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

    const removeRelation = useCallback((value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
        setter(prev => prev.filter(entry => entry !== value))
    }, [])

    const removeDependency = useCallback((value: string) => {
        removeRelation(value, setModalDependenciesDraft)
    }, [removeRelation])

    const removeConflict = useCallback((value: string) => {
        removeRelation(value, setModalConflictsDraft)
    }, [removeRelation])

    const removeAllowedUrl = useCallback((value: string) => {
        setModalAllowedUrlsDraft(prev => prev.filter(entry => entry !== value))
    }, [])

    const removeSupportedVersion = useCallback((value: string) => {
        setModalSupportedVersionsDraft(prev => prev.filter(entry => entry !== value))
    }, [])

    const applyRelationsEditor = useCallback(() => {
        setField('dependencies', modalDependenciesDraft)
        setField('conflictsWith', modalConflictsDraft)
        setIsRelationsEditorOpen(false)
    }, [modalConflictsDraft, modalDependenciesDraft, setField])

    const applyCompatibilityEditor = useCallback(() => {
        if (invalidModalSupportedVersions.length > 0) return

        setField('allowedUrls', modalAllowedUrlsDraft)
        setField('supportedVersions', modalSupportedVersionsDraft)
        setIsCompatibilityEditorOpen(false)
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

            try {
                window.desktopEvents?.send(MainEvents.REFRESH_MOD_INFO)
                window.desktopEvents?.send(MainEvents.REFRESH_EXTENSIONS)

                const nextAddons = await window.desktopEvents?.invoke(MainEvents.GET_ADDONS, { force: true })
                if (Array.isArray(nextAddons)) {
                    setAddons(nextAddons.filter(addon => addon.name !== 'Default'))
                }
            } catch (refreshError) {
                console.error('[MetadataEditor] metadata saved, but refresh failed', refreshError)
            }
        } catch (saveMetadataError) {
            console.error(saveMetadataError)
            setError(t('metadata.saveError'))
        } finally {
            setSaving(false)
        }
    }, [addonPath, draft, open, resolveRelIfNeeded, saving, setAddons, t, valid])

    const onReset = useCallback(() => {
        setDraft(baseRef.current)
    }, [])

    if (loading) {
        return <MetadataSkeleton />
    }

    if (error) return <div className={css.alert}>{error}</div>

    return (
        <div className={css.root}>
            <div className={css.metaGrid}>
                <div className={`${css.metaWide} ${css.metaSplit}`}>
                    <div className={css.metaMainColumn}>
                        <TextInput name="meta-name" label={t('metadata.labels.name')} value={draft.name} onChange={value => setField('name', value)} />
                        <TextInput
                            name="meta-description"
                            label={t('metadata.labels.description')}
                            value={draft.description}
                            onChange={value => setField('description', value)}
                            className={css.metaDescription}
                        />
                    </div>

                    <div className={css.metaSideColumn}>
                        <TextInput name="meta-author" label={t('metadata.labels.author')} value={draft.author} onChange={value => setField('author', value)} />

                        <div className={css.metaSideRow}>
                            <SelectInput
                                label={t('metadata.labels.type')}
                                value={draft.type}
                                options={[
                                    { value: 'theme', label: 'theme' },
                                    { value: 'script', label: 'script' },
                                    { value: 'library', label: 'library' },
                                ]}
                                onChange={value => setField('type', value as Metadata['type'])}
                            />

                            <TextInput
                                name="meta-version"
                                label={t('metadata.labels.version')}
                                value={draft.version}
                                onChange={value => setField('version', value)}
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
                            onChange={value => setField('image', value)}
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
                            onChange={value => setField('banner', value)}
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
                            onChange={value => setField('libraryLogo', value)}
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
                        onChange={value => setField('css', value)}
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
                        onChange={value => setField('script', value)}
                        placeholder={t('metadata.placeholders.scriptPath')}
                        metadata
                        addonPath={addonPath}
                        preferredBaseName="script"
                        accept=".js"
                    />
                </div>

                {relationsEnabled && (
                    <div className={css.editorCard}>
                        <div className={css.listEditorHeader}>
                            <div className={css.listEditorHeaderContent}>
                                <div className={css.listEditorTitle}>{t('metadata.relationsEditor.title')}</div>
                                <div className={css.listEditorDescription}>{t('metadata.relationsEditor.description')}</div>
                            </div>
                            <button type="button" className={css.listEditorButton} onClick={openRelationsEditor}>
                                {t('metadata.relationsEditor.edit')}
                            </button>
                        </div>

                        <div className={css.listSummaryRow}>
                            <div className={css.listSummaryMeta}>
                                <div className={css.listSummaryLabel}>{t('metadata.labels.dependencies')}</div>
                                <div className={css.listSummaryValue}>
                                    {draft.dependencies.length
                                        ? t('metadata.relationsEditor.dependenciesSummary', { count: draft.dependencies.length })
                                        : t('metadata.relationsEditor.previewEmpty')}
                                </div>
                            </div>

                            <div className={css.listSummaryMeta}>
                                <div className={css.listSummaryLabel}>{t('metadata.labels.conflictsWith')}</div>
                                <div className={css.listSummaryValue}>
                                    {draft.conflictsWith.length
                                        ? t('metadata.relationsEditor.conflictsSummary', { count: draft.conflictsWith.length })
                                        : t('metadata.relationsEditor.previewEmpty')}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className={css.editorCard}>
                    <div className={css.listEditorHeader}>
                        <div className={css.listEditorHeaderContent}>
                            <div className={css.listEditorTitle}>{t('metadata.compatibilityEditor.title')}</div>
                            <div className={css.listEditorDescription}>{t('metadata.compatibilityEditor.description')}</div>
                        </div>
                        <button type="button" className={css.listEditorButton} onClick={openCompatibilityEditor}>
                            {t('metadata.compatibilityEditor.edit')}
                        </button>
                    </div>

                    <div className={css.listSummaryRow}>
                        <div className={css.listSummaryMeta}>
                            <div className={css.listSummaryLabel}>{t('metadata.labels.allowedUrls')}</div>
                            <div className={css.listSummaryValue}>
                                {draft.allowedUrls.length
                                    ? t('metadata.compatibilityEditor.allowedUrlsSummary', { count: draft.allowedUrls.length })
                                    : t('metadata.compatibilityEditor.previewEmpty')}
                            </div>
                        </div>

                        <div className={css.listSummaryMeta}>
                            <div className={css.listSummaryLabel}>{t('metadata.labels.supportedVersions')}</div>
                            <div className={css.listSummaryValue}>
                                {draft.supportedVersions.length
                                    ? t('metadata.compatibilityEditor.supportedVersionsSummary', {
                                          value: draft.supportedVersions.join(', '),
                                      })
                                    : t('metadata.compatibilityEditor.previewEmpty')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {relationsEnabled && (
                <CustomModalPS
                    className={`${css.listEditorModal} ${css.relationsModal}`}
                    isOpen={isRelationsEditorOpen}
                    onClose={closeRelationsEditor}
                    buttons={[
                        {
                            text: t('common.cancel'),
                            onClick: closeRelationsEditor,
                            variant: 'secondary',
                        },
                        {
                            text: t('common.done'),
                            onClick: applyRelationsEditor,
                        },
                    ]}
                >
                    <div className={css.relationsModalHeader}>
                        <div className={css.relationsModalTitle}>{t('metadata.relationsEditor.title')}</div>
                        <div className={css.relationsModalDescription}>{t('metadata.relationsEditor.description')}</div>
                    </div>

                    <div className={`${css.listEditorModalBody} ${css.stackedEditorBody}`}>
                        <div className={css.listEditorSection}>
                            <div className={css.listEditorSectionHeader}>
                                <div className={css.listEditorFieldLabel}>{t('metadata.relationsEditor.dependenciesTitle')}</div>
                                <div className={css.listEditorHint}>{t('metadata.relationsEditor.dependenciesHint')}</div>
                            </div>

                            <div className={css.listEditorComposer}>
                                <SelectInput
                                    className={css.listEditorSelect}
                                    label={t('metadata.relationsEditor.dependenciesSelectLabel')}
                                    value={modalDependencySelection}
                                    options={relationOptions}
                                    onChange={value => setModalDependencySelection(String(value))}
                                    placeholder={t('metadata.relationsEditor.dependenciesPlaceholder')}
                                    searchable
                                    searchPlaceholder={t('metadata.relationsEditor.searchPlaceholder')}
                                />
                                <ButtonV2 className={css.listEditorAddButton} onClick={addDependency} disabled={!modalDependencySelection.trim()}>
                                    <MdAdd size={18} />
                                    <span>{t('metadata.relationsEditor.add')}</span>
                                </ButtonV2>
                            </div>

                            {modalDependenciesDraft.length ? (
                                <div className={css.listEditorItems}>
                                    {modalDependenciesDraft.map(dependencyId => (
                                        <div key={dependencyId} className={css.listEditorRow}>
                                            <div className={css.listEditorRowValue}>{relationLabelMap.get(dependencyId) || dependencyId}</div>
                                            <button type="button" className={css.listEditorRemoveButton} onClick={() => removeDependency(dependencyId)}>
                                                <MdClose size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={css.listEditorEmpty}>{t('metadata.relationsEditor.previewEmpty')}</div>
                            )}
                        </div>

                        <div className={css.listEditorSection}>
                            <div className={css.listEditorSectionHeader}>
                                <div className={css.listEditorFieldLabel}>{t('metadata.relationsEditor.conflictsTitle')}</div>
                                <div className={css.listEditorHint}>{t('metadata.relationsEditor.conflictsHint')}</div>
                            </div>

                            <div className={css.listEditorComposer}>
                                <SelectInput
                                    className={css.listEditorSelect}
                                    label={t('metadata.relationsEditor.conflictsSelectLabel')}
                                    value={modalConflictSelection}
                                    options={relationOptions}
                                    onChange={value => setModalConflictSelection(String(value))}
                                    placeholder={t('metadata.relationsEditor.conflictsPlaceholder')}
                                    searchable
                                    searchPlaceholder={t('metadata.relationsEditor.searchPlaceholder')}
                                />
                                <ButtonV2 className={css.listEditorAddButton} onClick={addConflict} disabled={!modalConflictSelection.trim()}>
                                    <MdAdd size={18} />
                                    <span>{t('metadata.relationsEditor.add')}</span>
                                </ButtonV2>
                            </div>

                            {modalConflictsDraft.length ? (
                                <div className={css.listEditorItems}>
                                    {modalConflictsDraft.map(conflictId => (
                                        <div key={conflictId} className={css.listEditorRow}>
                                            <div className={css.listEditorRowValue}>{relationLabelMap.get(conflictId) || conflictId}</div>
                                            <button type="button" className={css.listEditorRemoveButton} onClick={() => removeConflict(conflictId)}>
                                                <MdClose size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={css.listEditorEmpty}>{t('metadata.relationsEditor.previewEmpty')}</div>
                            )}
                        </div>
                    </div>
                </CustomModalPS>
            )}

            <CustomModalPS
                className={css.listEditorModal}
                isOpen={isCompatibilityEditorOpen}
                onClose={closeCompatibilityEditor}
                title={t('metadata.compatibilityEditor.title')}
                text={t('metadata.compatibilityEditor.description')}
                buttons={[
                    {
                        text: t('common.cancel'),
                        onClick: closeCompatibilityEditor,
                        variant: 'secondary',
                    },
                    {
                        text: t('common.done'),
                        onClick: applyCompatibilityEditor,
                        disabled: invalidModalSupportedVersions.length > 0,
                    },
                ]}
            >
                <div className={css.listEditorModalBody}>
                    <div className={css.listEditorSection}>
                        <div className={css.listEditorSectionHeader}>
                            <div className={css.listEditorFieldLabel}>{t('metadata.compatibilityEditor.allowedUrlsTitle')}</div>
                            <div className={css.listEditorHint}>{t('metadata.compatibilityEditor.allowedUrlsHint')}</div>
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
                                <span>{t('metadata.compatibilityEditor.add')}</span>
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
                            <div className={css.listEditorEmpty}>{t('metadata.compatibilityEditor.previewEmpty')}</div>
                        )}
                    </div>

                    <div className={css.listEditorSection}>
                        <div className={css.listEditorSectionHeader}>
                            <div className={css.listEditorFieldLabel}>{t('metadata.compatibilityEditor.supportedVersionsTitle')}</div>
                            <div className={css.listEditorHint}>{t('metadata.compatibilityEditor.supportedVersionsHint')}</div>
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
                                <span>{t('metadata.compatibilityEditor.add')}</span>
                            </ButtonV2>
                        </div>

                        {invalidPendingSupportedVersions.length > 0 && (
                            <div className={css.listEditorInlineError}>
                                {t('metadata.compatibilityEditor.invalidSupportedVersions', {
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
                            <div className={css.listEditorEmpty}>{t('metadata.compatibilityEditor.previewEmpty')}</div>
                        )}
                    </div>
                </div>

                {invalidModalSupportedVersions.length > 0 && (
                    <div className={css.listEditorError}>
                        {t('metadata.compatibilityEditor.invalidSupportedVersions', {
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
