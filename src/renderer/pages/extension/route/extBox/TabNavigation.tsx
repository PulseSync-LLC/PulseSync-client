import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
    const rootRef = useRef<HTMLDivElement>(null)
    const [indicator, setIndicator] = useState({ left: 0, width: 0 })
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

    const updateIndicator = useCallback(() => {
        const root = rootRef.current
        const list = root?.querySelector<HTMLElement>('[role="tablist"]')
        const selectedTab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        if (!list || !selectedTab) return

        const listRect = list.getBoundingClientRect()
        const tabRect = selectedTab.getBoundingClientRect()
        const next = { left: tabRect.left - listRect.left + list.scrollLeft, width: tabRect.width }
        setIndicator(current => (current.left === next.left && current.width === next.width ? current : next))
    }, [])

    useLayoutEffect(updateIndicator, [active, tabs.length, updateIndicator])

    useEffect(() => {
        const list = rootRef.current?.querySelector<HTMLElement>('[role="tablist"]')
        if (!list) return

        const observer = new ResizeObserver(updateIndicator)
        observer.observe(list)
        list.addEventListener('scroll', updateIndicator, { passive: true })
        return () => {
            observer.disconnect()
            list.removeEventListener('scroll', updateIndicator)
        }
    }, [updateIndicator])

    return (
        <div ref={rootRef} className={s.root}>
            <Tabs value={active} onChange={value => onChange(value as ActiveTab)} className={s.tabs}>
                <TabList className={s.list}>
                    <span
                        className={s.indicator}
                        style={{ width: indicator.width, transform: `translateX(${indicator.left}px)`, opacity: indicator.width > 0 ? 1 : 0 }}
                    />
                    {tabs.map(tab => (
                        <Tab key={tab.value} value={tab.value} className={s.tab}>
                            {tab.icon}
                            <span>{tab.title}</span>
                        </Tab>
                    ))}
                </TabList>
            </Tabs>
        </div>
    )
}

export default TabNavigation
