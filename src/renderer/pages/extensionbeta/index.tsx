import Layout from '../../components/layout'
import * as styles from '../../../../static/styles/page/index.module.scss'
import * as theme from './extension.module.scss'
import ExtensionCard from '../../components/extensionCard'
import React, { useContext, useEffect, useState } from 'react'
import ThemeInterface from '../../api/interfaces/theme.interface'
import stringSimilarity from 'string-similarity'
import CustomCheckbox from '../../components/checkbox_props'
import toast from '../../api/toast'
import userContext from '../../api/context/user.context'
import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'
import FilterImg from './../../../../static/assets/stratis-icons/filter.svg'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'
import { useSearchParams } from 'react-router-dom'

export default function ExtensionPage() {
    const [selectedTheme, setSelectedTheme] = useState(
        window.electron.store.get('theme') || 'Default',
    )
    const { themes, setThemes } = useContext(userContext)
    const [maxThemesCount, setMaxThemesCount] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const [hideEnabled, setHideEnabled] = useState(
        window.electron.store.get('themes.hideEnabled') || false,
    )
    const [filterVisible, setFilterVisible] = useState(false)

    const [selectedTags, setSelectedTags] = useState<Set<string>>(
        new Set(window.electron.store.get('themes.selectedTags') || []),
    )
    const [columnsCount, setColumnsCount] = useState(
        window.electron.store.get('themes.columnsCount') || 3,
    )

    const handleFilterHover = () => setFilterVisible(true)
    const handleFilterLeave = () => setFilterVisible(false)
    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)

    const loadThemes = () => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getThemes')
                .then((themes: ThemeInterface[]) => {
                    setThemes(themes)
                })
                .catch(error =>
                    console.error('Ошибка при загрузке тем:', error),
                )
        }
    }

    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags(prevTags => new Set(prevTags).add(selectedTagFromURL))
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadThemes()
    }, [])

    const handleReloadThemes = () => {
        setThemes([])
        loadThemes()
        toast.success('Темы перезагружены')
    }

    const handleCheckboxChange = (themeName: string, isChecked: boolean) => {
        const newTheme = isChecked ? themeName : 'Default'
        window.electron.store.set('theme', newTheme)
        setSelectedTheme(newTheme)
        window.desktopEvents.send('themeChanged', newTheme)
    }

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(event.target.value.toLowerCase())
    }

    const handleHideEnabledChange = (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        setHideEnabled(event.target.checked)
    }

    const handleTagChange = (tag: string) => {
        const updatedTags = new Set(selectedTags)
        if (updatedTags.has(tag)) {
            updatedTags.delete(tag)
        } else {
            updatedTags.add(tag)
        }
        setSelectedTags(updatedTags)
    }

    const filterAndSortThemes = (themes: ThemeInterface[]) => {
        return themes
            .filter(theme => theme.name !== 'Default')
            .map(theme => ({
                ...theme,
                matches:
                    theme.name.toLowerCase().includes(searchQuery) ||
                    theme.author.toLowerCase().includes(searchQuery) ||
                    stringSimilarity.compareTwoStrings(
                        theme.name.toLowerCase(),
                        searchQuery,
                    ) > 0.35 ||
                    stringSimilarity.compareTwoStrings(
                        theme.author.toLowerCase(),
                        searchQuery,
                    ) > 0.35,
            }))
            .sort((a, b) => (a.matches === b.matches ? 0 : a.matches ? -1 : 1))
    }

    const filterThemesByTags = (
        themes: ThemeInterface[],
        tags: Set<string>,
    ) => {
        if (tags.size === 0) return themes
        return themes.filter(theme => theme.tags?.some(tag => tags.has(tag)))
    }

    const getFilteredThemes = (themeType: string) => {
        const filteredThemes = filterAndSortThemes(
            filterThemesByTags(themes, selectedTags),
        )
        return themeType === selectedTheme
            ? filteredThemes.filter(theme => theme.name === selectedTheme)
            : filteredThemes.filter(theme => theme.name !== selectedTheme)
    }

    const enabledThemes = getFilteredThemes(selectedTheme)
    const disabledThemes = getFilteredThemes('other')
    const filteredEnabledThemes = hideEnabled ? [] : enabledThemes
    const filteredDisabledThemes = hideEnabled ? disabledThemes : disabledThemes
    const allTags = Array.from(
        new Set(themes.flatMap(theme => theme.tags || [])),
    )
    const tagCounts = allTags.reduce(
        (acc, tag) => {
            acc[tag] = themes.filter(theme => theme.tags?.includes(tag)).length
            return acc
        },
        {} as Record<string, number>,
    )

    const filterThemes = (themes: ThemeInterface[]) => {
        return themes
            .filter(
                theme =>
                    theme.name.toLowerCase() !== 'default' &&
                    (theme.name
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()) ||
                        theme.author
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                        stringSimilarity.compareTwoStrings(
                            theme.name.toLowerCase(),
                            searchQuery.toLowerCase(),
                        ) > 0.35 ||
                        stringSimilarity.compareTwoStrings(
                            theme.author.toLowerCase(),
                            searchQuery.toLowerCase(),
                        ) > 0.35),
            )
            .sort((a, b) => (a.name < b.name ? -1 : 1))
    }

    const filteredThemes = filterThemes(themes)

    useEffect(() => {
        setMaxThemesCount(prevCount =>
            Math.max(prevCount, filteredThemes.length),
        )
    }, [filteredThemes])

    useEffect(() => {
        window.electron.store.set(
            'themes.selectedTags',
            Array.from(selectedTags),
        )
        window.electron.store.set('themes.columnsCount', columnsCount)
        window.electron.store.set('themes.hideEnabled', hideEnabled)
    }, [selectedTags, columnsCount, hideEnabled])

    const handleColumnsChange = (count: number) => {
        setColumnsCount(count)
    }

    return (
        <Layout title="Стилизация">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <div className={theme.toolbar}>
                            <div className={theme.containerToolbar}>
                                <div className={theme.searchContainer}>
                                    <SearchImg />
                                    <input
                                        className={theme.searchInput}
                                        type="text"
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        placeholder="Введите название расширения"
                                    />
                                    {filteredThemes.length > 0 &&
                                        filteredThemes.length <
                                            maxThemesCount && (
                                            <div className={theme.searchLabel}>
                                                Найдено: {filteredThemes.length}
                                            </div>
                                        )}
                                    {filteredThemes.length === 0 && (
                                        <div className={theme.searchLabel}>
                                            Ничего не найдено
                                        </div>
                                    )}
                                </div>
                                <button
                                    className={theme.toolbarButton}
                                    onClick={() =>
                                        window.desktopEvents.send(
                                            'openPath',
                                            {
                                                action: 'themePath',
                                            }
                                        )
                                    }
                                >
                                    <FileImg />
                                </button>
                                <button
                                    className={`${theme.toolbarButton} ${theme.refreshButton}`}
                                    onClick={handleReloadThemes}
                                >
                                    <ArrowRefreshImg />
                                </button>
                                <button
                                    className={`${theme.toolbarButton} ${filterVisible ? theme.toolbarButtonActive : ''}`}
                                    onMouseEnter={handleFilterHover}
                                >
                                    <FilterImg />
                                    {activeTagCount > 0 && (
                                        <div className={theme.count}>
                                            {activeTagCount > 9
                                                ? '9+'
                                                : activeTagCount}
                                        </div>
                                    )}
                                </button>
                            </div>
                            {filterVisible && (
                                <div
                                    className={theme.containerSearch}
                                    onMouseLeave={handleFilterLeave}
                                >
                                    <div className={theme.tagsSection}>
                                        <div className={theme.tagsLabel}>
                                            Tags
                                        </div>
                                        <div className={theme.tagsContainer}>
                                            <CustomCheckbox
                                                checked={hideEnabled}
                                                onChange={
                                                    handleHideEnabledChange
                                                }
                                                label="Скрыть включенные"
                                                className={
                                                    hideEnabled
                                                        ? theme.selectedTag
                                                        : ''
                                                }
                                            />
                                            {allTags.map(tag => (
                                                <CustomCheckbox
                                                    key={tag}
                                                    checked={selectedTags.has(
                                                        tag,
                                                    )}
                                                    onChange={() =>
                                                        handleTagChange(tag)
                                                    }
                                                    label={`${tag} (${tagCounts[tag]})`}
                                                    className={
                                                        selectedTags.has(tag)
                                                            ? theme.selectedTag
                                                            : ''
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className={theme.tagsSection}>
                                        <div className={theme.tagsLabel}>
                                            Колонки:{' '}
                                        </div>
                                        <div className={theme.tagsContainer}>
                                            {[2, 3, 4].map(count => (
                                                <CustomCheckbox
                                                    key={count}
                                                    checked={
                                                        columnsCount === count
                                                    }
                                                    onChange={() =>
                                                        handleColumnsChange(
                                                            count,
                                                        )
                                                    }
                                                    label={`${count} колонок`}
                                                    className={
                                                        columnsCount === count
                                                            ? theme.selectedTag
                                                            : ''
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className={styles.container30x15}>
                            <div className={theme.preview}>
                                {filteredEnabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div
                                            className={
                                                theme.selectionContainerLable
                                            }
                                        >
                                            <div
                                                className={theme.labelSelection}
                                            >
                                                Enable
                                            </div>
                                            <div className={theme.line}></div>
                                        </div>
                                        <div
                                            className={theme.grid}
                                            style={{
                                                gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                            }}
                                        >
                                            {filteredEnabledThemes.map(
                                                theme => (
                                                    <ExtensionCard
                                                        key={theme.name}
                                                        theme={theme}
                                                        isChecked={true}
                                                        onCheckboxChange={
                                                            handleCheckboxChange
                                                        }
                                                        className={
                                                            theme.matches
                                                                ? 'highlight'
                                                                : 'dimmed'
                                                        }
                                                    />
                                                ),
                                            )}
                                        </div>
                                    </div>
                                )}
                                {filteredDisabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div
                                            className={
                                                theme.selectionContainerLable
                                            }
                                        >
                                            <div
                                                className={theme.labelSelection}
                                            >
                                                Disable
                                            </div>
                                            <div className={theme.line}></div>
                                        </div>
                                        <div
                                            className={theme.grid}
                                            style={{
                                                gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                            }}
                                        >
                                            {filteredDisabledThemes.map(
                                                theme => (
                                                    <ExtensionCard
                                                        key={theme.name}
                                                        theme={theme}
                                                        isChecked={false}
                                                        onCheckboxChange={
                                                            handleCheckboxChange
                                                        }
                                                        className={
                                                            theme.matches
                                                                ? 'highlight'
                                                                : 'dimmed'
                                                        }
                                                    />
                                                ),
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
