import React, { startTransition } from 'react'
import * as styles from './AddonFilters.module.scss'
import Scrollbar from '../../PSUI/Scrollbar'
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md'

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
            // По умолчанию сортировка должна быть по убыванию
            onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')
        } else {
            // Если сортировка по новому параметру, начинаем с сортировки по убыванию
            onSortChange(option)
            onSortOrderChange('desc') // Сортировка по убыванию по умолчанию
        }
    }

    return (
        <Scrollbar className={styles.filterWindow} classNameInner={styles.filterWindowInner}>
            {/* Сортировка */}
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>СОРТИРОВКА</div>
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
                                  ? 'По алфавиту'
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
                                        transition: "var(--transition)",
                                        transform: sortOrder === 'asc' ? "rotate(0deg)" : "rotate(180deg)"
                                    }}
                                />
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Тип аддонов */}
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>ТИП</div>
                {['all', 'theme', 'script'].map(opt => (
                    <div key={opt} className={`${styles.radioLabel} ${type === opt ? styles.selected : ''}`} onClick={() => setType(opt as any)}>
                        <div className={`${styles.customRadio} ${type === opt ? styles.selected : ''}`} />
                        {opt === 'all' ? 'Все' : opt === 'theme' ? 'Темы' : 'Скрипты'}
                    </div>
                ))}
            </div>

            {/* Теги */}
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>ТЕГИ</div>
                {tags.map(tag => (
                    <label key={tag} className={`${styles.checkboxLabel} ${selectedTags.has(tag) ? styles.selected : ''}`}>
                        <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => toggleSet(selectedTags, tag, setSelectedTags)} />
                        <span className={styles.customCheckbox}></span>
                        {tag}
                    </label>
                ))}
            </div>

            {/* Авторы */}
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>АВТОРЫ</div>
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
