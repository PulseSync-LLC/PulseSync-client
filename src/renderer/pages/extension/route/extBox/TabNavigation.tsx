import React from 'react'
import { MdFactCheck } from 'react-icons/md'
import { ActiveTab, DESCRIPTION_TAB, DocTab, LICENSE_TAB, PUBLICATION_CHANGELOG_TAB, RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import { Tab, TabList, Tabs } from '@pulsesync/uikit/navigation'
import { staticAsset } from '@shared/lib/staticAssets'
import { useTranslation } from 'react-i18next'
import * as s from './TabNavigation.module.scss'

interface TabItem {
    title: string
    value: string
    icon?: React.ReactNode
}

interface Props {
    active: ActiveTab
    onChange: (t: ActiveTab) => void
    docs: DocTab[]
    hasPublicationChangelog?: boolean
    hasRelations?: boolean
    showMetadataTab?: boolean
}

const TabNavigation: React.FC<Props> = ({
    active,
    onChange,
    docs,
    hasPublicationChangelog = false,
    hasRelations = false,
    showMetadataTab = false,
}) => {
    const { t } = useTranslation()
    const bookIcon = staticAsset('assets/icons/ui/tab-book.svg')
    const settingsIcon = staticAsset('assets/icons/ui/tab-settings.svg')
    const licenseDoc = docs.find(doc => /license|licence/i.test(doc.value || doc.title))
    const licenseHeading = licenseDoc?.content.match(/^\s*#*\s*([^\r\n]*licen[cs]e[^\r\n]*)/im)?.[1]?.trim()
    const licenseTitle = licenseHeading || licenseDoc?.title || t('extensions.tabs.license')
    const changelogDoc = docs.find(doc => /changelog|changes|патчноут/i.test(doc.value || doc.title))

    const tabs: TabItem[] = [
        { title: t('extensions.tabs.description'), value: DESCRIPTION_TAB, icon: <img src={bookIcon} alt="" /> },
        { title: t('extensions.tabs.settings'), value: 'Settings', icon: <img src={settingsIcon} alt="" /> },
        { title: licenseTitle, value: LICENSE_TAB, icon: <img src={bookIcon} alt="" /> },
        ...(changelogDoc
            ? [{ title: changelogDoc.title, value: changelogDoc.value || changelogDoc.title, icon: <img src={bookIcon} alt="" /> }]
            : hasPublicationChangelog
              ? [{ title: t('extensions.tabs.changelog'), value: PUBLICATION_CHANGELOG_TAB, icon: <img src={bookIcon} alt="" /> }]
              : []),
        ...(hasRelations ? [{ title: t('extensions.tabs.relations'), value: RELATIONS_TAB, icon: <MdFactCheck size={19} /> }] : []),
        ...(showMetadataTab ? [{ title: t('extensions.tabs.metadata'), value: 'Metadata' }] : []),
    ]

    return (
        <Tabs value={active} onChange={value => onChange(value as ActiveTab)} className={s.root}>
            <TabList className={s.list}>
                {tabs.map(tab => (
                    <Tab key={tab.value} value={tab.value} className={s.tab}>
                        {tab.icon}
                        <span>{tab.title}</span>
                    </Tab>
                ))}
            </TabList>
        </Tabs>
    )
}

export default TabNavigation
