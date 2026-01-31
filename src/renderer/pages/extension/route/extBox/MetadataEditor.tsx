import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import path from 'path'
import MainEvents from '../../../../../common/types/mainEvents'
import RendererEvents from '../../../../../common/types/rendererEvents'
import semver from 'semver'

import TextInput from '../../../../components/PSUI/TextInput'
import SelectInput from '../../../../components/PSUI/SelectInput'
import FileInput from '../../../../components/PSUI/FileInput'
import ChangesBar from '../../../../components/PSUI/ChangesBar'

import * as css from './MetadataEditor.module.scss'
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

const MetadataEditor: React.FC<Props> = ({ addonPath }) => {
    const { t } = useTranslation()
    const [draft, setDraft] = useState<Metadata>(DEFAULT_META)
    const baseRef = useRef<Metadata>(DEFAULT_META)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

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

    const allowedUrlsAsString = useMemo(() => draft.allowedUrls.join(', '), [draft.allowedUrls])
    const setAllowedUrlsFromString = useCallback(
        (v: string) => {
            const next = v
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            setField('allowedUrls', next)
        },
        [setField],
    )

    const supportedVersionsAsString = useMemo(() => draft.supportedVersions.join(', '), [draft.supportedVersions])
    const setSupportedVersionsFromString = useCallback(
        (v: string) => {
            const next = v
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            setField(
                'supportedVersions',
                next.filter(ver => semver.validRange(ver)),
            )
        },
        [setField],
    )

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

            const file = path.join(addonPath, 'metadata.json')
            await window.desktopEvents.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, file, JSON.stringify(next, null, 2))

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

    if (loading) return <div className={css.alert}>{t('common.loading')}</div>
    if (error) return <div className={css.alert}>{error}</div>

    return (
        <div className={css.root}>
            <div className={css.metaGrid}>
                <TextInput name="meta-name" label={t('metadata.labels.name')} value={draft.name} onChange={v => setField('name', v)} />
                <TextInput name="meta-author" label={t('metadata.labels.author')} value={draft.author} onChange={v => setField('author', v)} />

                <TextInput
                    name="meta-description"
                    label={t('metadata.labels.description')}
                    value={draft.description}
                    onChange={v => setField('description', v)}
                />
                <TextInput
                    name="meta-version"
                    label={t('metadata.labels.version')}
                    value={draft.version}
                    onChange={v => setField('version', v)}
                    description={!SEMVER.test(draft.version) ? t('metadata.versionFormat') : undefined}
                />

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
                    name="meta-tags"
                    label={t('metadata.labels.tags')}
                    value={tagsAsString}
                    onChange={setTagsFromString}
                    description={t('metadata.examples.tags')}
                />

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
                    label={t('metadata.labels.script')}
                    value={draft.script}
                    onChange={p => setField('script', p)}
                    placeholder={t('metadata.placeholders.scriptPath')}
                    metadata
                    addonPath={addonPath}
                    preferredBaseName="script"
                    accept=".js"
                />
                <TextInput
                    name="meta-dependencies"
                    label={t('metadata.labels.dependencies')}
                    value={dependenciesAsString}
                    onChange={setDependenciesFromString}
                    description={t('metadata.examples.addonName')}
                />
                <TextInput
                    name="meta-allowedUrls"
                    label={t('metadata.labels.allowedUrls')}
                    value={allowedUrlsAsString}
                    onChange={setAllowedUrlsFromString}
                    description={t('metadata.examples.allowedUrls')}
                />

                <TextInput
                    name="meta-supportedVersions"
                    label={t('metadata.labels.supportedVersions')}
                    value={supportedVersionsAsString}
                    onChange={setSupportedVersionsFromString}
                    description={t('metadata.examples.supportedVersions')}
                />
            </div>

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
