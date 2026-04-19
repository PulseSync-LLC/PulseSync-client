import React from 'react'
import { MdConstruction, MdFactCheck, MdSettings, MdStickyNote2 } from 'react-icons/md'
import { ActiveTab, DocTab, PUBLICATION_CHANGELOG_TAB, RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import PSUITabNavigation, { TabItem } from '@shared/ui/PSUI/Tabs'
import { useTranslation } from 'react-i18next'

interface Props {
    active: ActiveTab
    onChange: (t: ActiveTab) => void
    docs: DocTab[]
    hasPublicationChangelog?: boolean
    hasRelations?: boolean
    showMetadataTab?: boolean
    stickyTop?: number
}

const TabNavigation: React.FC<Props> = ({ active, onChange, docs, hasPublicationChangelog = false, hasRelations = false, showMetadataTab = true, stickyTop }) => {
    const { t } = useTranslation()

    const docTabs: TabItem[] = docs.map(d => ({
        title: d.title,
        value: d.value || d.title,
        icon: <MdStickyNote2 size={22} />,
    }))

    const tabs: TabItem[] = [
        ...docTabs,
        ...(hasPublicationChangelog ? [{ title: t('extensions.tabs.changelog'), value: PUBLICATION_CHANGELOG_TAB, icon: <MdStickyNote2 size={22} /> }] : []),
        ...(hasRelations ? [{ title: t('extensions.tabs.relations'), value: RELATIONS_TAB, icon: <MdFactCheck size={22} /> }] : []),
        { title: t('extensions.tabs.settings'), value: 'Settings', icon: <MdSettings size={22} /> },
        ...(showMetadataTab ? [{ title: t('extensions.tabs.metadata'), value: 'Metadata', icon: <MdConstruction size={22} /> }] : []),
    ]

    return <PSUITabNavigation active={active} onChange={onChange} tabs={tabs} stickyPos={stickyTop == null ? undefined : { top: `${stickyTop}px` }} />
}

export default TabNavigation
