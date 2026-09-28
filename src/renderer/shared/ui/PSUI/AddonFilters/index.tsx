import React, { type ReactNode } from 'react'

import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import { useTranslation } from 'react-i18next'
import { MdLabelOutline, MdPersonOutline, MdSort, MdViewModule } from 'react-icons/md'

import * as styles from '@shared/ui/PSUI/AddonFilters/AddonFilters.module.scss'

import type Addon from '@entities/addon/model/addon.interface'

type AddonTypeFilter = 'all' | Addon['type']
type SortKey = 'author' | 'alphabet' | 'date' | 'size' | 'type'

const ADDON_TYPE_FILTERS: AddonTypeFilter[] = ['all', 'theme', 'script', 'web-addon']
const SORT_FILTERS: SortKey[] = ['type', 'alphabet', 'date', 'size', 'author']

interface AddonFiltersProps {
    children: ReactNode
    tags: string[]
    creators: string[]
    sort: SortKey
    sortOrder: 'asc' | 'desc'
    type: AddonTypeFilter
    selectedTags: Set<string>
    selectedCreators: Set<string>
    onSortChange: (option: SortKey) => void
    setType: React.Dispatch<React.SetStateAction<AddonTypeFilter>>
    setSelectedTags: React.Dispatch<React.SetStateAction<Set<string>>>
    setSelectedCreators: React.Dispatch<React.SetStateAction<Set<string>>>
    onSortOrderChange: (order: 'asc' | 'desc') => void
    onOpenChange?: (open: boolean) => void
}

export default function AddonFilters({
    children,
    tags,
    creators,
    type,
    setType,
    selectedTags,
    setSelectedTags,
    selectedCreators,
    setSelectedCreators,
    sort,
    sortOrder,
    onSortChange,
    onSortOrderChange,
    onOpenChange,
}: AddonFiltersProps) {
    const { t } = useTranslation()

    const toggleSet = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
        const copy = new Set(set)
        if (copy.has(value)) {
            copy.delete(value)
        } else {
            copy.add(value)
        }
        setter(copy)
    }

    const handleSortClick = (option: SortKey) => {
        if (sort === option) {
            onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')
            return
        }

        onSortChange(option)
        onSortOrderChange(option === 'alphabet' || option === 'author' || option === 'date' ? 'asc' : 'desc')
    }

    const sortLabel = (option: SortKey) => {
        if (option === 'type') return t('filters.sort.byType')
        if (option === 'alphabet') {
            const order = sort === option ? (sortOrder === 'asc' ? t('filters.sort.az') : t('filters.sort.za')) : ''
            return t('filters.sort.byAlphabet', { order })
        }
        if (option === 'date') return t('filters.sort.byDate')
        if (option === 'size') return t('filters.sort.bySize')
        return t('filters.sort.byAuthors')
    }

    const typeLabel = (option: AddonTypeFilter) => {
        if (option === 'all') return t('filters.type.all')
        if (option === 'theme') return t('filters.type.themes')
        if (option === 'script') return t('filters.type.scripts')
        return t('filters.type.webAddons')
    }

    const items: DropdownMenuItem[] = [
        {
            key: 'sort',
            label: t('filters.sort.title'),
            icon: <MdSort />,
            children: SORT_FILTERS.map(option => ({
                key: `sort-${option}`,
                label: sortLabel(option),
                radio: true,
                checked: sort === option,
                onClick: () => handleSortClick(option),
            })),
        },
        {
            key: 'type',
            label: t('filters.type.title'),
            icon: <MdViewModule />,
            children: ADDON_TYPE_FILTERS.map(option => ({
                key: `type-${option}`,
                label: typeLabel(option),
                radio: true,
                checked: type === option,
                onClick: () => setType(option),
            })),
        },
        {
            key: 'tags',
            label: t('filters.tags.title'),
            icon: <MdLabelOutline />,
            children: tags.map(tag => ({
                key: `tag-${tag}`,
                label: tag,
                toggle: true,
                checked: selectedTags.has(tag),
                onClick: () => toggleSet(selectedTags, tag, setSelectedTags),
            })),
        },
        {
            key: 'authors',
            label: t('filters.authors.title'),
            icon: <MdPersonOutline />,
            children: creators.map(creator => ({
                key: `creator-${creator}`,
                label: creator,
                toggle: true,
                checked: selectedCreators.has(creator),
                onClick: () => toggleSet(selectedCreators, creator, setSelectedCreators),
            })),
        },
    ]

    return (
        <DropdownMenu
            items={items}
            menuClassName={styles.menu}
            placement="right-start"
            mode="hover"
            closeOnSelect={false}
            onOpenChange={onOpenChange}
        >
            {children}
        </DropdownMenu>
    )
}
