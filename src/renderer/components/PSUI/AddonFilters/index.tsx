import React from 'react'
import cn from 'clsx'
import * as styles from './AddonFilters.module.scss'
import Scrollbar from '../../PSUI/Scrollbar'
import { MdKeyboardArrowUp, MdRefresh } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

interface AddonFiltersProps {
    tags: string[]
    creators: string[]
    sort: 'author' | 'alphabet' | 'date' | 'size' | 'type'
    sortOrder: 'asc' | 'desc'
    type: 'theme' | 'script' | 'all'
    selectedTags: Set<string>
    selectedCreators: Set<string>
    onSortChange: (option: 'author' | 'alphabet' | 'date' | 'size' | 'type') => void
    onTypeChange: (newType: 'theme' | 'script' | 'all') => void
    onToggleTag: (tag: string) => void
    onToggleCreator: (creator: string) => void
    setType: React.Dispatch<React.SetStateAction<'theme' | 'script' | 'all'>>
    setSelectedTags: React.Dispatch<React.SetStateAction<Set<string>>>
    setSelectedCreators: React.Dispatch<React.SetStateAction<Set<string>>>
    onSortOrderChange: (order: 'asc' | 'desc') => void
}

export default function AddonFilters({
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
}: AddonFiltersProps) {
    const { t } = useTranslation()
    const toggleSet = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
        const copy = new Set(set)
        copy.has(value) ? copy.delete(value) : copy.add(value)
        setter(copy)
    }

    const handleSortClick = (option: 'alphabet' | 'date' | 'size' | 'author' | 'type') => {
        if (sort === option) {
            onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')
        } else {
            onSortChange(option)
            onSortOrderChange(option === 'alphabet' || option === 'author' || option === 'date' ? 'asc' : 'desc')
        }
    }

    const resetSort = () => {
        onSortChange('type')
        onSortOrderChange('desc')
    }

    const resetType = () => {
        setType('all')
    }

    const resetTags = () => {
        setSelectedTags(new Set())
    }

    const resetCreators = () => {
        setSelectedCreators(new Set())
    }

    const renderTitle = (title: string, onReset: () => void, showReset: boolean) => (
        <div className={styles.filterTitle}>
            {title}
            {showReset && <MdRefresh size={16} className={styles.resetIcon} onClick={onReset} />}
        </div>
    )
    const alphabetOrderLabel = sort === 'alphabet' ? (sortOrder === 'asc' ? t('filters.sort.az') : t('filters.sort.za')) : ''

    return (
        <Scrollbar className={styles.filterWindow} classNameInner={styles.filterWindowInner}>
            <div className={styles.filterGroup}>
                {renderTitle(t('filters.sort.title'), resetSort, sort !== 'type' || sortOrder !== 'desc')}
                {['type', 'alphabet', 'date', 'size', 'author'].map(opt => (
                    <div
                        key={opt}
                        className={cn(styles.radioLabel, sort === opt && styles.selected)}
                        onClick={() => handleSortClick(opt as any)}
                    >
                        <div className={cn(styles.customRadio, sort === opt && styles.selected)} />
                        <div className={styles.textGroup}>
                            <div className={styles.text}>
                                {opt === 'type'
                                    ? t('filters.sort.byType')
                                    : opt === 'alphabet'
                                      ? t('filters.sort.byAlphabet', { order: alphabetOrderLabel })
                                      : opt === 'date'
                                        ? t('filters.sort.byDate')
                                        : opt === 'size'
                                          ? t('filters.sort.bySize')
                                          : t('filters.sort.byAuthors')}
                            </div>
                            {sort === opt && (
                                <MdKeyboardArrowUp
                                    size={18}
                                    style={{
                                        transition: 'var(--transition)',
                                        transform: (() => {
                                            const inverted = ['alphabet', 'author', 'date'].includes(opt)
                                            const shouldRotate = inverted ? sortOrder === 'asc' : sortOrder === 'desc'
                                            return shouldRotate ? 'rotate(180deg)' : 'rotate(0deg)'
                                        })(),
                                    }}
                                />
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className={styles.filterGroup}>
                {renderTitle(t('filters.type.title'), resetType, type !== 'all')}
                {['all', 'theme', 'script'].map(opt => (
                    <div key={opt} className={cn(styles.radioLabel, type === opt && styles.selected)} onClick={() => setType(opt as any)}>
                        <div className={cn(styles.customRadio, type === opt && styles.selected)} />
                        {opt === 'all' ? t('filters.type.all') : opt === 'theme' ? t('filters.type.themes') : t('filters.type.scripts')}
                    </div>
                ))}
            </div>

            <div className={styles.filterGroup}>
                {renderTitle(t('filters.tags.title'), resetTags, selectedTags.size > 0)}
                {tags.map(tag => (
                    <label key={tag} className={cn(styles.checkboxLabel, selectedTags.has(tag) && styles.selected)}>
                        <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => toggleSet(selectedTags, tag, setSelectedTags)} />
                        <span className={styles.customCheckbox}></span>
                        {tag}
                    </label>
                ))}
            </div>

            <div className={styles.filterGroup}>
                {renderTitle(t('filters.authors.title'), resetCreators, selectedCreators.size > 0)}
                {creators.map(creator => (
                    <label key={creator} className={cn(styles.checkboxLabel, selectedCreators.has(creator) && styles.selected)}>
                        <input
                            type="checkbox"
                            checked={selectedCreators.has(creator)}
                            onChange={() => toggleSet(selectedCreators, creator, setSelectedCreators)}
                        />
                        <span className={styles.customCheckbox}></span>
                        {creator}
                    </label>
                ))}
            </div>
        </Scrollbar>
    )
}
