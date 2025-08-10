import React, { useMemo, useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import path from 'path'

import MetadataEditor from './MetadataEditor'

import ConfigurationSettings from '../../../../components/сonfigurationSettings/ConfigurationSettings'
import ConfigurationSettingsEdit from '../../../../components/сonfigurationSettings/ConfigurationSettingsEdit'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'

import { ActiveTab, DocTab } from './types'
import * as styles from './../extensionview.module.scss'
import appConfig from '../../../../api/config'
import Addon from '../../../../api/interfaces/addon.interface'

interface Props {
    active: ActiveTab
    docs: DocTab[]
    configExists: boolean | null
    config: AddonConfig | null
    configApi: {
        reload?: () => Promise<void> | void
        save?: (cfg: AddonConfig) => Promise<void> | void
    }
    editMode: boolean
    addon: Addon
}

const slug = (t: string) =>
    t
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\wа-яё0-9-]/gi, '')

const Heading =
    (lvl: number) =>
    ({ children, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const id = slug(React.Children.toArray(children).join(''))
        const Tag = `h${lvl}` as React.ElementType
        return (
            <Tag id={id} {...rest}>
                {children}
            </Tag>
        )
    }

const defaultTemplate = {} as AddonConfig

const TabContent: React.FC<Props> = ({ active, docs, config, configApi, editMode, addon }) => {
    const addonName = path.basename(addon.path)
    const [creating, setCreating] = useState(false)
    const [settingsKey, setSettingsKey] = useState(0)

    useEffect(() => {
        setCreating(false)
        setSettingsKey(k => k + 1)
    }, [addon.path])

    useEffect(() => {
        if (creating && config) setCreating(false)
    }, [creating, config])

    const asset = useMemo(
        () => (f: string) => `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?name=${encodeURIComponent(addonName)}&file=${encodeURIComponent(f)}`,
        [addonName],
    )

    const MDImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ src = '', alt, ...rest }) => {
        let resolved = src
        if (!/^(https?:|data:)/i.test(src)) resolved = asset(src)
        else if (src.includes('github.com') && src.includes('/blob/'))
            resolved = src.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/')
        return <img className={styles.markdownImage} src={resolved} alt={alt} {...rest} />
    }

    if (active === 'Settings') {
        if (!config && !creating)
            return (
                <div className={styles.alertContent}>
                    <p>
                        Файл <code>handleEvents.json</code> не найден.
                    </p>
                    <button
                        className={styles.primaryButton}
                        onClick={async () => {
                            setCreating(true)
                            const fp = path.join(addon.path, 'handleEvents.json')
                            await window.desktopEvents?.invoke('file-event', 'write-file', fp, JSON.stringify(defaultTemplate, null, 4))
                            await configApi?.reload?.()
                            setSettingsKey(k => k + 1)
                        }}
                    >
                        Создать handleEvents.json
                    </button>
                </div>
            )

        if (creating && !config) return <div className={styles.alertContent}>Перезайдите в тему!</div>

        if (config) {
            return editMode ? (
                <ConfigurationSettingsEdit key={`${addon.path}:${settingsKey}:edit`} {...configApi} configData={config} filePreviewSrc={asset} />
            ) : (
                <ConfigurationSettings key={`${addon.path}:${settingsKey}:use`} {...configApi} configData={config} filePreviewSrc={asset} />
            )
        }
    }

    if (active === 'Metadata') return <MetadataEditor addonPath={addon.path} />

    const doc = docs.find(d => d.title === active)
    if (!doc) return <div className={styles.alertContent}>Файл не найден</div>

    return (
        <div className={styles.galleryContainer}>
            <div className={styles.markdownContent}>
                <div className={styles.markdownText}>
                    <ReactMarkdown
                        skipHtml={false}
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                            img: MDImg,
                            a: ({ node, ...p }) => (
                                <a
                                    href={p.href?.startsWith('#') ? p.href : `${encodeURIComponent(addon.directoryName)}/${p.href}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    {...p}
                                >
                                    {p.children}
                                </a>
                            ),
                            h1: Heading(1),
                            h2: Heading(2),
                            h3: Heading(3),
                            h4: Heading(4),
                            h5: Heading(5),
                            h6: Heading(6),
                        }}
                    >
                        {doc.content || addon.description}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    )
}

export default TabContent
