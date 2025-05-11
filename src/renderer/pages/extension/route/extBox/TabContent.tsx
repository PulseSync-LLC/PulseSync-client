import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import ConfigurationSettings from '../../../../components/сonfigurationSettings/ConfigurationSettings'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'
import * as s from '../extensionview.module.scss'
import { ActiveTab } from './types'

interface Props {
    active: ActiveTab
    markdown: string
    description: string
    configExists: boolean | null
    config: AddonConfig | null
    configApi: any
    editMode: boolean
}

const MarkdownLink = (p: any) => (
    <a {...p} target="_blank" rel="noreferrer">
        {p.children}
    </a>
)

const TabContent: React.FC<Props> = ({ active, markdown, description, configExists, config, configApi, editMode }) => {
    if (active === 'Overview')
        return (
            <div className={s.galleryContainer}>
                <div className={s.markdownContent}>
                    <div className={s.markdownText}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]} components={{ a: MarkdownLink }}>
                            {markdown || description}
                        </ReactMarkdown>
                    </div>
                </div>
            </div>
        )

    if (active === 'Settings') {
        if (configExists === false) return <div className={s.alertContent}>Создайте handleEvents.json</div>

        return config ? <ConfigurationSettings {...configApi} configData={config} editMode={editMode} /> : null
    }

    return <div className={s.alertContent}>Страница в разработке</div>
}

export default TabContent
