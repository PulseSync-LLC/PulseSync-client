import React, { useMemo, useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import path from 'path'
import MainEvents from '../../../../../common/types/mainEvents'
import RendererEvents from '../../../../../common/types/rendererEvents'

import MetadataEditor from './MetadataEditor'

import ConfigurationSettings from '../../../../components/сonfigurationSettings/ConfigurationSettings'
import ConfigurationSettingsEdit from '../../../../components/сonfigurationSettings/ConfigurationSettingsEdit'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'

import { ActiveTab, DocTab } from './types'
import * as styles from './../extensionview.module.scss'
import appConfig from '@common/appConfig'
import Addon from '../../../../api/interfaces/addon.interface'
import { t as i18nT } from '../../../../i18n'
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

const defaultTemplate: AddonConfig = {
    sections: [
        {
            title: i18nT('extensions.defaults.interface.title'),
            items: [
                {
                    id: 'primaryColor',
                    name: i18nT('extensions.defaults.interface.primaryColor'),
                    description: i18nT('extensions.defaults.interface.primaryColorDescription'),
                    type: 'color',
                    input: '#3b82f6',
                    defaultParameter: '#3b82f6',
                },
                {
                    id: 'secondaryColor',
                    name: i18nT('extensions.defaults.interface.secondaryColor'),
                    description: i18nT('extensions.defaults.interface.secondaryColorDescription'),
                    type: 'color',
                    input: '#10b981',
                    defaultParameter: '#10b981',
                },
                {
                    id: 'borderRadius',
                    name: i18nT('extensions.defaults.interface.borderRadius'),
                    description: i18nT('extensions.defaults.interface.borderRadiusDescription'),
                    type: 'slider',
                    min: 0,
                    max: 30,
                    step: 1,
                    value: 8,
                    defaultParameter: 8,
                },
                {
                    id: 'layoutStyle',
                    name: i18nT('extensions.defaults.interface.layoutStyle'),
                    description: i18nT('extensions.defaults.interface.layoutStyleDescription'),
                    type: 'selector',
                    selected: 2,
                    options: {
                        '1': { event: 'grid', name: i18nT('extensions.defaults.interface.layoutGrid') },
                        '2': { event: 'list', name: i18nT('extensions.defaults.interface.layoutList') },
                        '3': { event: 'compact', name: i18nT('extensions.defaults.interface.layoutCompact') },
                    },
                    defaultParameter: 2,
                },
                {
                    id: 'darkMode',
                    name: i18nT('extensions.defaults.interface.darkMode'),
                    description: i18nT('extensions.defaults.interface.darkModeDescription'),
                    type: 'button',
                    bool: false,
                    defaultParameter: false,
                },
            ],
        },
        {
            title: i18nT('extensions.defaults.player.title'),
            items: [
                {
                    id: 'enableCrossfade',
                    name: i18nT('extensions.defaults.player.crossfade'),
                    description: i18nT('extensions.defaults.player.crossfadeDescription'),
                    type: 'button',
                    bool: true,
                    defaultParameter: true,
                },
                {
                    id: 'crossfadeDuration',
                    name: i18nT('extensions.defaults.player.crossfadeDuration'),
                    description: i18nT('extensions.defaults.player.crossfadeDurationDescription'),
                    type: 'slider',
                    min: 0,
                    max: 12,
                    step: 1,
                    value: 6,
                    defaultParameter: 6,
                },
                {
                    id: 'audioQuality',
                    name: i18nT('extensions.defaults.player.audioQuality'),
                    description: i18nT('extensions.defaults.player.audioQualityDescription'),
                    type: 'selector',
                    selected: 3,
                    options: {
                        '1': { event: 'low', name: i18nT('extensions.defaults.player.qualityLow') },
                        '2': { event: 'medium', name: i18nT('extensions.defaults.player.qualityMedium') },
                        '3': { event: 'high', name: i18nT('extensions.defaults.player.qualityHigh') },
                    },
                    defaultParameter: 3,
                },
                {
                    id: 'customEqualizerPreset',
                    name: i18nT('extensions.defaults.player.customEq'),
                    description: i18nT('extensions.defaults.player.customEqDescription'),
                    type: 'file',
                    filePath: '',
                    defaultParameter: { filePath: '' },
                },
            ],
        },
        {
            title: i18nT('extensions.defaults.notifications.title'),
            items: [
                {
                    id: 'desktopNotifications',
                    name: i18nT('extensions.defaults.notifications.desktop'),
                    description: i18nT('extensions.defaults.notifications.desktopDescription'),
                    type: 'button',
                    bool: true,
                    defaultParameter: true,
                },
                {
                    id: 'notificationSound',
                    name: i18nT('extensions.defaults.notifications.sound'),
                    description: i18nT('extensions.defaults.notifications.soundDescription'),
                    type: 'selector',
                    selected: 1,
                    options: {
                        '1': { event: 'chime', name: i18nT('extensions.defaults.notifications.soundChime') },
                        '2': { event: 'pop', name: i18nT('extensions.defaults.notifications.soundPop') },
                        '3': { event: 'ding', name: i18nT('extensions.defaults.notifications.soundDing') },
                    },
                    defaultParameter: 1,
                },
                {
                    id: 'notificationVolume',
                    name: i18nT('extensions.defaults.notifications.volume'),
                    description: i18nT('extensions.defaults.notifications.volumeDescription'),
                    type: 'slider',
                    min: 0,
                    max: 100,
                    step: 5,
                    value: 60,
                    defaultParameter: 60,
                },
            ],
        },
        {
            title: i18nT('extensions.defaults.about.title'),
            items: [
                {
                    id: 'aboutText',
                    name: i18nT('extensions.defaults.about.text'),
                    description: i18nT('extensions.defaults.about.textDescription'),
                    type: 'text',
                    buttons: [
                        {
                            id: 'name',
                            name: i18nT('extensions.defaults.about.appName'),
                            text: i18nT('extensions.defaults.about.sampleName'),
                            defaultParameter: i18nT('extensions.defaults.about.sampleName'),
                        },
                        {
                            id: 'tagline',
                            name: i18nT('extensions.defaults.about.tagline'),
                            text: i18nT('extensions.defaults.about.sampleTagline'),
                            defaultParameter: i18nT('extensions.defaults.about.sampleTagline'),
                        },
                        {
                            id: 'version',
                            name: i18nT('extensions.defaults.about.version'),
                            text: i18nT('extensions.defaults.about.sampleVersion'),
                            defaultParameter: i18nT('extensions.defaults.about.sampleVersion'),
                        },
                    ],
                },
                {
                    id: 'customLogo',
                    name: i18nT('extensions.defaults.about.logo'),
                    description: i18nT('extensions.defaults.about.logoDescription'),
                    type: 'file',
                    filePath: '',
                    defaultParameter: { filePath: '' },
                },
            ],
        },
    ],
}

const TabContent: React.FC<Props> = ({ active, docs, config, configApi, editMode, addon }) => {
    const { t } = useTranslation()
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
                                JSON.stringify(defaultTemplate, null, 4),
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

