import React from 'react'
import { MdConstruction, MdSettings, MdStickyNote2 } from 'react-icons/md'
import { ActiveTab, DocTab } from './types'
import PSUITabNavigation, { TabItem } from '../../../../components/PSUI/Tabs'

interface Props {
    active: ActiveTab
    onChange: (t: ActiveTab) => void
    docs: DocTab[]
}

const TabNavigation: React.FC<Props> = ({ active, onChange, docs }) => {
    const docTabs: TabItem[] = docs.map(d => ({
        title: d.title,
        icon: <MdStickyNote2 size={22} />,
    }))

    const tabs: TabItem[] = [
        ...docTabs,
        { title: 'Settings', icon: <MdSettings size={22} /> },
        { title: 'Metadata', icon: <MdConstruction size={22} /> },
    ]

    return <PSUITabNavigation active={active} onChange={onChange} tabs={tabs} />
}

export default TabNavigation
