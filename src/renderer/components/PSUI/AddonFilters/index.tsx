import React from 'react'
import * as styles from './AddonFilters.module.scss'
import Scrollbar from '../../PSUI/Scrollbar'
import { MdKeyboardArrowUp, MdRefresh } from 'react-icons/md'

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

    return (
        <Scrollbar className={styles.filterWindow} classNameInner={styles.filterWindowInner}>
            <div className={styles.filterGroup}>
                {renderTitle('СОРТИРОВКА', resetSort, sort !== 'type' || sortOrder !== 'desc')}
                {['type', 'alphabet', 'date', 'size', 'author'].map(opt => (
                    <div
                        key={opt}
                        className={`${styles.radioLabel} ${sort === opt ? styles.selected : ''}`}
                        onClick={() => handleSortClick(opt as any)}
                    >
                        <div className={`${styles.customRadio} ${sort === opt ? styles.selected : ''}`} />
                        <div className={styles.textGroup}>
                            <div className={styles.text}>
                                {opt === 'type'
                                    ? 'По типу'
                                    : opt === 'alphabet'
                                      ? `По алфавиту${sort === 'alphabet' ? (sortOrder === 'asc' ? ' (А-Я)' : ' (Я-А)') : ''}`
                                      : opt === 'date'
                                        ? 'По дате'
                                        : opt === 'size'
                                          ? 'По размеру'
                                          : 'По авторам'}
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
                {renderTitle('ТИП', resetType, type !== 'all')}
                {['all', 'theme', 'script'].map(opt => (
                    <div key={opt} className={`${styles.radioLabel} ${type === opt ? styles.selected : ''}`} onClick={() => setType(opt as any)}>
                        <div className={`${styles.customRadio} ${type === opt ? styles.selected : ''}`} />
                        {opt === 'all' ? 'Все' : opt === 'theme' ? 'Темы' : 'Скрипты'}
                    </div>
                ))}
            </div>

            <div className={styles.filterGroup}>
                {renderTitle('ТЕГИ', resetTags, selectedTags.size > 0)}
                {tags.map(tag => (
                    <label key={tag} className={`${styles.checkboxLabel} ${selectedTags.has(tag) ? styles.selected : ''}`}>
                        <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => toggleSet(selectedTags, tag, setSelectedTags)} />
                        <span className={styles.customCheckbox}></span>
                        {tag}
                    </label>
                ))}
            </div>

            <div className={styles.filterGroup}>
                {renderTitle('АВТОРЫ', resetCreators, selectedCreators.size > 0)}
                {creators.map(creator => (
                    <label key={creator} className={`${styles.checkboxLabel} ${selectedCreators.has(creator) ? styles.selected : ''}`}>
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
