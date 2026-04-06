import React from 'react'
import { MdConstruction, MdSettings, MdStickyNote2 } from 'react-icons/md'
import { ActiveTab, DocTab, PUBLICATION_CHANGELOG_TAB } from '@pages/extension/route/extBox/types'
import PSUITabNavigation, { TabItem } from '@shared/ui/PSUI/Tabs'

interface Props {
    active: ActiveTab
    onChange: (t: ActiveTab) => void
    docs: DocTab[]
    hasPublicationChangelog?: boolean
}

const TabNavigation: React.FC<Props> = ({ active, onChange, docs, hasPublicationChangelog = false }) => {
    const docTabs: TabItem[] = docs.map(d => ({
        title: d.title,
        icon: <MdStickyNote2 size={22} />,
    }))

    const tabs: TabItem[] = [
        ...docTabs,
        ...(hasPublicationChangelog ? [{ title: PUBLICATION_CHANGELOG_TAB, icon: <MdStickyNote2 size={22} /> }] : []),
        { title: 'Settings', icon: <MdSettings size={22} /> },
        { title: 'Metadata', icon: <MdConstruction size={22} /> },
    ]

    return <PSUITabNavigation active={active} onChange={onChange} tabs={tabs} />
}

export default TabNavigation
