import React from 'react'
import cn from 'clsx'
import * as s from '@shared/ui/PSUI/Tabs/Tabs.module.scss'
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md'

export interface TabItem {
    title: string
    value?: string
    icon: React.ReactNode
}

interface Props {
    active: string
    onChange: (title: string) => void
    tabs: TabItem[]
    sortDirection?: 'asc' | 'desc'
    stickyPos?: React.CSSProperties
}

const Tabs: React.FC<Props> = ({ active, onChange, tabs, sortDirection, stickyPos }) => (
    <div className={s.extensionNav} style={stickyPos}>
        <div className={s.extensionNavContainer}>
            {tabs.map(tab => (
                <button
                    key={tab.value || tab.title}
                    className={cn(s.extensionNavButton, active === (tab.value || tab.title) && s.activeTabButton)}
                    onClick={() => onChange(tab.value || tab.title)}
                >
                    {tab.icon} {tab.title}
                    {active === (tab.value || tab.title) &&
                        sortDirection &&
                        (sortDirection === 'asc' ? <MdKeyboardArrowUp className={s.sortIcon} /> : <MdKeyboardArrowDown className={s.sortIcon} />)}
                </button>
            ))}
        </div>
    </div>
)

export default Tabs
