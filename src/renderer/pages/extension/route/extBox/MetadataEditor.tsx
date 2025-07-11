import React, { useEffect, useState } from 'react'
import path from 'path'
import * as s from '../extensionview.module.scss'
import TextInput from '../../../../components/PSUI/TextInput'
import ButtonInput from '../../../../components/PSUI/ButtonInput'

interface Metadata {
    name: string
    image: string
    banner: string
    author: string
    description: string
    version: string
    css: string
    script: string
    type: string
    tags: string[]
}

interface Props {
    addonPath: string
}

const MetadataEditor: React.FC<Props> = ({ addonPath }) => {
    const [meta, setMeta] = useState<Metadata | null>(null)
    const [dirty, setDirty] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const file = path.join(addonPath, 'metadata.json')
                const res = await window.desktopEvents.invoke('file-event', 'read-file', file)
                const parsed = JSON.parse(res)
                const obj: Metadata = {
                    name: parsed.name ?? '',
                    image: parsed.image ?? '',
                    banner: parsed.banner ?? '',
                    author: parsed.author ?? '',
                    description: parsed.description ?? '',
                    version: parsed.version ?? '',
                    css: parsed.css ?? '',
                    script: parsed.script ?? '',
                    type: parsed.type ?? '',
                    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
                }
                setMeta(obj)
                setDirty(false)
            } catch (e) {
                console.error(e)
                setError('Не удалось загрузить metadata.json')
            }
        }
        load()
    }, [addonPath])

    const handleChange = (key: keyof Metadata, value: string) => {
        if (!meta) return
        const next: Metadata = {
            ...meta,
            tags:
                key === 'tags'
                    ? value
                          .split(',')
                          .map(t => t.trim())
                          .filter(t => t.length > 0)
                    : meta.tags,
            [key]: key === 'tags' ? meta.tags : value,
        } as unknown as Metadata

        if (key === 'tags') {
            next.tags = value
                .split(',')
                .map(t => t.trim())
                .filter(t => t.length > 0)
        }
        setMeta(next)
        setDirty(true)
    }

    const handleSave = async () => {
        if (!meta) return
        try {
            const file = path.join(addonPath, 'metadata.json')
            await window.desktopEvents.invoke('file-event', 'write-file', file, JSON.stringify(meta, null, 2))
            setDirty(false)
            setError(null)
        } catch (e) {
            console.error(e)
            setError('Не удалось сохранить metadata.json')
        }
    }

    const handleCancel = async () => {
        try {
            const file = path.join(addonPath, 'metadata.json')
            const res = await window.desktopEvents.invoke('file-event', 'read-file', file)
            const parsed = JSON.parse(res)
            const obj: Metadata = {
                name: parsed.name ?? '',
                image: parsed.image ?? '',
                banner: parsed.banner ?? '',
                author: parsed.author ?? '',
                description: parsed.description ?? '',
                version: parsed.version ?? '',
                css: parsed.css ?? '',
                script: parsed.script ?? '',
                type: parsed.type ?? '',
                tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            }
            setMeta(obj)
            setDirty(false)
            setError(null)
        } catch (e) {
            console.error(e)
            setError('Не удалось сбросить изменения — ошибка чтения файла')
        }
    }

    if (error) return <div className={s.alertContent}>{error}</div>
    if (!meta) return <div className={s.alertContent}>Загрузка...</div>

    return (
        <div className={s.formContainer}>
            <TextInput className={s.metaType} name="meta-name" label="Name" value={meta.name} onChange={v => handleChange('name', v)} />
            <TextInput className={s.metaType} name="meta-author" label="Author" value={meta.author} onChange={v => handleChange('author', v)} />
            <TextInput
                className={s.metaType}
                name="meta-description"
                label="Description"
                value={meta.description}
                onChange={v => handleChange('description', v)}
            />
            <TextInput className={s.metaType} name="meta-version" label="Version" value={meta.version} onChange={v => handleChange('version', v)} />
            <TextInput className={s.metaType} name="meta-image" label="Image" value={meta.image} onChange={v => handleChange('image', v)} />
            <TextInput className={s.metaType} name="meta-banner" label="Banner" value={meta.banner} onChange={v => handleChange('banner', v)} />
            <TextInput className={s.metaType} name="meta-css" label="CSS" value={meta.css} onChange={v => handleChange('css', v)} />
            <TextInput className={s.metaType} name="meta-script" label="Script" value={meta.script} onChange={v => handleChange('script', v)} />
            <TextInput className={s.metaType} name="meta-type" label="Type" value={meta.type} onChange={v => handleChange('type', v)} />
            <TextInput
                className={s.metaType}
                name="meta-tags"
                label="Tags (comma-separated)"
                value={meta.tags.join(', ')}
                onChange={v => handleChange('tags', v)}
            />

            <div className={s.buttonGroup}>
                <ButtonInput disabled={!dirty} onClick={handleSave} className={s.saveButton} label="Сохранить metadata.json" />
                <ButtonInput disabled={!dirty} onClick={handleCancel} className={s.cancelButton} label="Отменить изменения" />
            </div>
        </div>
    )
}

export default MetadataEditor
