import React, { useMemo, useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import path from 'path'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import MetadataEditor from '@pages/extension/route/extBox/MetadataEditor'

import ConfigurationSettings from '@features/configurationSettings/ConfigurationSettings'
import ConfigurationSettingsEdit from '@features/configurationSettings/ConfigurationSettingsEdit'
import { AddonConfig } from '@features/configurationSettings/types'

import { ActiveTab, DocTab, PUBLICATION_CHANGELOG_TAB } from '@pages/extension/route/extBox/types'
import * as styles from '@pages/extension/route/extensionview.module.scss'
import appConfig from '@common/appConfig'
import Addon from '@entities/addon/model/addon.interface'
import { normalizeStoreAddonChangelogMarkdown } from '@entities/addon/lib/storeAddonChangelog'
import type { StoreAddonRelease } from '@entities/addon/model/storeAddon.interface'
import { useTranslation } from 'react-i18next'

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
    publicationReleases?: StoreAddonRelease[]
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

const createDefaultTemplate = (): AddonConfig => ({
    sections: [
        {
            title: 'Interface',
            items: [
                {
                    id: 'primaryColor',
                    name: 'Primary color',
                    description: 'Main accent color for buttons and highlights',
                    type: 'color',
                    value: '#3b82f6',
                    defaultValue: '#3b82f6',
                },
                {
                    id: 'secondaryColor',
                    name: 'Secondary color',
                    description: 'Additional accent color for UI elements',
                    type: 'color',
                    value: '#10b981',
                    defaultValue: '#10b981',
                },
                {
                    id: 'borderRadius',
                    name: 'Border radius',
                    description: 'Roundness of cards, buttons, and inputs',
                    type: 'slider',
                    min: 0,
                    max: 30,
                    step: 1,
                    value: 8,
                    defaultValue: 8,
                },
                {
                    id: 'layoutStyle',
                    name: 'Layout style',
                    description: 'Choose how lists and blocks should be displayed',
                    type: 'selector',
                    value: 2,
                    options: {
                        '1': { event: 'grid', name: 'Grid' },
                        '2': { event: 'list', name: 'List' },
                        '3': { event: 'compact', name: 'Compact' },
                    },
                    defaultValue: 2,
                },
                {
                    id: 'darkMode',
                    name: 'Dark mode',
                    description: 'Enable the dark appearance for the interface',
                    type: 'button',
                    value: false,
                    defaultValue: false,
                },
            ],
        },
        {
            title: 'Player',
            items: [
                {
                    id: 'enableCrossfade',
                    name: 'Enable crossfade',
                    description: 'Smoothly fade between tracks during playback',
                    type: 'button',
                    value: true,
                    defaultValue: true,
                },
                {
                    id: 'crossfadeDuration',
                    name: 'Crossfade duration',
                    description: 'Length of the fade effect between tracks in seconds',
                    type: 'slider',
                    min: 0,
                    max: 12,
                    step: 1,
                    value: 6,
                    defaultValue: 6,
                },
                {
                    id: 'audioQuality',
                    name: 'Audio quality',
                    description: 'Preferred playback quality',
                    type: 'selector',
                    value: 3,
                    options: {
                        '1': { event: 'low', name: 'Low' },
                        '2': { event: 'medium', name: 'Medium' },
                        '3': { event: 'high', name: 'High' },
                    },
                    defaultValue: 3,
                },
                {
                    id: 'customEqualizerPreset',
                    name: 'Custom equalizer preset',
                    description: 'Path to your custom EQ preset file',
                    type: 'file',
                    value: '',
                    defaultValue: '',
                },
            ],
        },
        {
            title: 'Notifications',
            items: [
                {
                    id: 'desktopNotifications',
                    name: 'Desktop notifications',
                    description: 'Show notifications for important events',
                    type: 'button',
                    value: true,
                    defaultValue: true,
                },
                {
                    id: 'notificationSound',
                    name: 'Notification sound',
                    description: 'Select the sound played for notifications',
                    type: 'selector',
                    value: 1,
                    options: {
                        '1': { event: 'chime', name: 'Chime' },
                        '2': { event: 'pop', name: 'Pop' },
                        '3': { event: 'ding', name: 'Ding' },
                    },
                    defaultValue: 1,
                },
                {
                    id: 'notificationVolume',
                    name: 'Notification volume',
                    description: 'Volume level for notification sounds',
                    type: 'slider',
                    min: 0,
                    max: 100,
                    step: 5,
                    value: 60,
                    defaultValue: 60,
                },
            ],
        },
        {
            title: 'About',
            items: [
                {
                    id: 'aboutName',
                    name: 'Application name',
                    description: 'Displayed name of the application or theme',
                    type: 'text',
                    value: 'PulseSync',
                    defaultValue: 'PulseSync',
                },
                {
                    id: 'aboutTagline',
                    name: 'Tagline',
                    description: 'Short description shown near the title',
                    type: 'text',
                    value: 'Your music, your rules',
                    defaultValue: 'Your music, your rules',
                },
                {
                    id: 'aboutVersion',
                    name: 'Version',
                    description: 'Version label displayed in the UI',
                    type: 'text',
                    value: '1.0.0',
                    defaultValue: '1.0.0',
                },
                {
                    id: 'customLogo',
                    name: 'Custom logo',
                    description: 'Path to a logo image file',
                    type: 'file',
                    value: '',
                    defaultValue: '',
                },
            ],
        },
    ],
})

const TabContent: React.FC<Props> = ({ active, docs, config, configApi, editMode, addon, publicationReleases = [] }) => {
    const { t } = useTranslation()
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
        () => (f: string) =>
            `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?directory=${encodeURIComponent(addon.directoryName)}&file=${encodeURIComponent(f)}`,
        [addon.directoryName],
    )

    const MDImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ src = '', alt, ...rest }) => {
        let resolved = src
        if (!/^(https?:|data:)/i.test(src)) resolved = asset(src)
        else if (src.includes('github.com') && src.includes('/blob/'))
            resolved = src.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/')
        return <img className={styles.markdownImage} src={resolved} alt={alt} {...rest} />
    }

    const isConfigEmpty = !config || !Array.isArray(config.sections) || config.sections.length === 0

    if (active === 'Settings') {
        if (isConfigEmpty && !creating)
            return (
                <div className={styles.alertContent}>
                    <p>{t('extensions.handleEventsMissing')}</p>
                    <button
                        className={styles.primaryButton}
                        onClick={async () => {
                            setCreating(true)
                            const fp = path.join(addon.path, 'handleEvents.json')
                            await window.desktopEvents?.invoke(
                                MainEvents.FILE_EVENT,
                                RendererEvents.WRITE_FILE,
                                fp,
                                JSON.stringify(createDefaultTemplate(), null, 4),
                            )
                            await configApi?.reload?.()
                            setSettingsKey(k => k + 1)
                        }}
                    >
                        {t('extensions.createHandleEvents')}
                    </button>
                </div>
            )

        if (creating && isConfigEmpty) return <div className={styles.alertContent}>{t('extensions.reopenTheme')}</div>

        if (config) {
            return editMode ? (
                <ConfigurationSettingsEdit key={`${addon.path}:${settingsKey}:edit`} {...configApi} configData={config} filePreviewSrc={asset} />
            ) : (
                <ConfigurationSettings key={`${addon.path}:${settingsKey}:use`} {...configApi} configData={config} filePreviewSrc={asset} />
            )
        }
    }

    if (active === 'Metadata') return <MetadataEditor addonPath={addon.path} />

    if (active === PUBLICATION_CHANGELOG_TAB && addon.installSource === 'store' && publicationReleases.length > 0) {
        return (
            <div className={styles.galleryContainer}>
                <div className={styles.changelogPanel}>
                    <div className={styles.changelogTitle}>{t('extensions.publication.changelogTabTitle')}</div>
                    {publicationReleases.length ? (
                        <div className={styles.changelogList}>
                            {publicationReleases.map(release => {
                                const changelogMarkdown = normalizeStoreAddonChangelogMarkdown(release.changelog)

                                return (
                                    <div key={release.id} className={styles.changelogItem}>
                                        <div className={styles.changelogVersionRow}>
                                            <span className={styles.changelogVersion}>v{release.version}</span>
                                            <span className={styles.changelogDate}>
                                                {new Date(release.updatedAt || release.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                        {changelogMarkdown ? (
                                            <div className={styles.markdownText}>
                                                <ReactMarkdown skipHtml={false} remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
                                                    {changelogMarkdown}
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            <div className={styles.alertContent}>{t('extensions.publication.changelogEmpty')}</div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className={styles.alertContent}>{t('extensions.publication.changelogEmpty')}</div>
                    )}
                </div>
            </div>
        )
    }

    const doc = docs.find(d => d.title === active)
    if (!doc) return <div className={styles.alertContent}>{t('common.fileNotFound')}</div>

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
                            a: ({ ...p }) => (
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
