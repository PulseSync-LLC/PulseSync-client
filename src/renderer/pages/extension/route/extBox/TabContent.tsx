import React, { JSX, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import path from 'path'

import MetadataEditor from './MetadataEditor'
import ConfigurationSettings from '../../../../components/сonfigurationSettings/ConfigurationSettings'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'
import { ActiveTab, DocTab } from './types'
import * as s from './../extensionview.module.scss'
import appConfig from '../../../../api/config'

interface Props {
    active: ActiveTab
    docs: DocTab[]
    description: string
    configExists: boolean | null
    config: AddonConfig | null
    configApi: any
    editMode: boolean
    addonPath: string
}

const MarkdownLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({ children, href = '', ...rest }) => {
    if (href.startsWith('#')) {
        return (
            <a href={href} {...rest}>
                {children}
            </a>
        )
    }
    return (
        <a href={href} {...rest} target="_blank" rel="noreferrer">
            {children}
        </a>
    )
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s]+/g, '-')
        .replace(/[^\wа-яё0-9-]/gi, '')
}

const HeadingRenderer =
    (level: number) =>
    ({ children, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const text = React.Children.toArray(children).join('')
        const id = slugify(text)
        const Tag = `h${level}` as React.ElementType
        return (
            <Tag id={id} {...rest}>
                {children}
            </Tag>
        )
    }

const TabContent: React.FC<Props> = ({ active, docs, description, configExists, config, configApi, editMode, addonPath }) => {
    const addonName = path.basename(addonPath)

    const buildAssetUrl = useMemo(
        () => (file: string) =>
            `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?name=${encodeURIComponent(addonName)}&file=${encodeURIComponent(file)}`,
        [addonName],
    )

    const MarkdownImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ src = '', alt, ...rest }) => {
        let resolvedSrc = src
        if (!/^(https?:|data:)/i.test(src)) {
            resolvedSrc = buildAssetUrl(src)
        } else if (src.includes('github.com') && src.includes('/blob/')) {
            resolvedSrc = src.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/')
        }
        return <img className={s.markdownImage} src={resolvedSrc} alt={alt} {...rest} />
    }

    if (active === 'Settings') {
        if (configExists === false) return <div className={s.alertContent}>Создайте handleEvents.json</div>
        return config ? <ConfigurationSettings {...configApi} configData={config} editMode={editMode} /> : null
    }

    if (active === 'Metadata') {
        return <MetadataEditor addonPath={addonPath} />
    }

    const doc = docs.find(d => d.title === active)
    if (!doc) return <div className={s.alertContent}>Файл не найден</div>

    return (
        <div className={s.galleryContainer}>
            <div className={s.markdownContent}>
                <div className={s.markdownText}>
                    <ReactMarkdown
                        skipHtml={false}
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                            img: MarkdownImg,
                            a: MarkdownLink,
                            h1: HeadingRenderer(1),
                            h2: HeadingRenderer(2),
                            h3: HeadingRenderer(3),
                            h4: HeadingRenderer(4),
                            h5: HeadingRenderer(5),
                            h6: HeadingRenderer(6),
                        }}
                    >
                        {doc.content || description}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    )
}

export default TabContent
