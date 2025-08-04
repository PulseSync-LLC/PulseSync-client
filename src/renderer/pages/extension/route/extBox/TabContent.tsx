import React, { useMemo, useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import path from 'path'

import MetadataEditor from './MetadataEditor'
import ConfigurationSettings from '../../../../components/сonfigurationSettings/ConfigurationSettings'
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
    configApi: any
    editMode: boolean
    addon: Addon
}


const MarkdownLink: React.FC<{ href?: string; addon: Addon } & React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
    children,
    href = '',
    addon,
    ...rest
}) => {
    if (!href) return <>{children}</>
    if (href.startsWith('#'))
        return (
            <a href={href} {...rest}>
                {children}
            </a>
        )
    const full = /^(https?:|\/\/)/i.test(href) ? href : `${encodeURIComponent(addon.directoryName)}/${href}`
    return (
        <a href={full} target="_blank" rel="noreferrer" {...rest}>
            {children}
        </a>
    )
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
            title: 'Интерфейс',
            items: [
                {
                    id: 'primaryColor',
                    name: 'Основной цвет',
                    description: 'Базовый акцент интерфейса.',
                    type: 'color',
                    input: '#3b82f6',
                    defaultParameter: '#3b82f6',
                },
                {
                    id: 'secondaryColor',
                    name: 'Вторичный цвет',
                    description: 'Дополнительный акцент для кнопок/ссылок.',
                    type: 'color',
                    input: '#10b981',
                    defaultParameter: '#10b981',
                },
                {
                    id: 'borderRadius',
                    name: 'Скругление углов',
                    description: 'Насколько скруглять углы элементов.',
                    type: 'slider',
                    min: 0,
                    max: 30,
                    step: 1,
                    value: 8,
                    defaultParameter: 8,
                },
                {
                    id: 'layoutStyle',
                    name: 'Стиль расположения',
                    description: 'Как располагать карточки контента.',
                    type: 'selector',
                    selected: 2,
                    options: {
                        '1': { event: 'grid', name: 'Сетка' },
                        '2': { event: 'list', name: 'Список' },
                        '3': { event: 'compact', name: 'Компакт' },
                    },
                    defaultParameter: 2,
                },
                {
                    id: 'darkMode',
                    name: 'Тёмная тема',
                    description: 'Переключить интерфейс в тёмный режим.',
                    type: 'button',
                    bool: false,
                    defaultParameter: false,
                },
            ],
        },
        {
            title: 'Плеер',
            items: [
                {
                    id: 'enableCrossfade',
                    name: 'Кроссфейд',
                    description: 'Плавное переключение треков.',
                    type: 'button',
                    bool: true,
                    defaultParameter: true,
                },
                {
                    id: 'crossfadeDuration',
                    name: 'Длительность кроссфейда',
                    description: 'Секунды плавного перехода.',
                    type: 'slider',
                    min: 0,
                    max: 12,
                    step: 1,
                    value: 6,
                    defaultParameter: 6,
                },
                {
                    id: 'audioQuality',
                    name: 'Качество звука',
                    description: 'Выберите пресет качества.',
                    type: 'selector',
                    selected: 3,
                    options: {
                        '1': { event: 'low', name: '96 kbps' },
                        '2': { event: 'medium', name: '192 kbps' },
                        '3': { event: 'high', name: '320 kbps' },
                    },
                    defaultParameter: 3,
                },
                {
                    id: 'customEqualizerPreset',
                    name: 'Пользовательский эквалайзер',
                    description: 'Загрузите файл пресета (.json / .eq).',
                    type: 'file',
                    filePath: '',
                    defaultParameter: { filePath: '' },
                },
            ],
        },
        {
            title: 'Уведомления',
            items: [
                {
                    id: 'desktopNotifications',
                    name: 'Desktop-уведомления',
                    description: 'Показывать уведомления на рабочем столе.',
                    type: 'button',
                    bool: true,
                    defaultParameter: true,
                },
                {
                    id: 'notificationSound',
                    name: 'Звук уведомления',
                    description: 'Выберите звуковой сигнал.',
                    type: 'selector',
                    selected: 1,
                    options: {
                        '1': { event: 'chime', name: 'Chime' },
                        '2': { event: 'pop', name: 'Pop' },
                        '3': { event: 'ding', name: 'Ding' },
                    },
                    defaultParameter: 1,
                },
                {
                    id: 'notificationVolume',
                    name: 'Громкость уведомлений',
                    description: 'Уровень громкости звука.',
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
            title: 'О программе',
            items: [
                {
                    id: 'aboutText',
                    name: 'Текст «О приложении»',
                    description: 'Название, слоган и версия.',
                    type: 'text',
                    buttons: [
                        {
                            id: 'name',
                            name: 'Название',
                            text: 'SuperAudio',
                            defaultParameter: 'SuperAudio',
                        },
                        {
                            id: 'tagline',
                            name: 'Слоган',
                            text: 'Music for everyone',
                            defaultParameter: 'Music for everyone',
                        },
                        {
                            id: 'version',
                            name: 'Версия',
                            text: '1.0.0',
                            defaultParameter: '1.0.0',
                        },
                    ],
                },
                {
                    id: 'customLogo',
                    name: 'Логотип',
                    description: 'Загрузите SVG/PNG логотип.',
                    type: 'file',
                    filePath: '',
                    defaultParameter: { filePath: '' },
                },
            ],
        },
    ],
}


const TabContent: React.FC<Props> = ({ active, docs, config, configApi, editMode, addon }) => {
    const addonName = path.basename(addon.path)

    const [creating, setCreating] = useState(false)
    const [settingsKey, setSettingsKey] = useState(0)

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

        if (config) return <ConfigurationSettings key={settingsKey} {...configApi} configData={config} editMode={editMode} />
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
                                <MarkdownLink href={p.href} addon={addon} {...p}>
                                    {p.children}
                                </MarkdownLink>
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
