import React, { useContext, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as extensionStyles from './extension.module.scss'
import ExtensionCard from '../../components/extensionCard'
import ThemeInterface from '../../api/interfaces/theme.interface'
import stringSimilarity from 'string-similarity'
import CustomCheckbox from '../../components/checkbox_props'
import toast from '../../api/toast'
import userContext from '../../api/context/user.context'
import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'
import FilterImg from './../../../../static/assets/stratis-icons/filter.svg'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'
import { motion } from 'framer-motion'

export default function ExtensionPage() {
    const [currentThemeName, setCurrentThemeName] = useState(
        window.electron.store.get('theme') || 'Default',
    )
    const { themes, setThemes } = useContext(userContext)
    const [maxThemeCount, setMaxThemeCount] = useState(0)
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

    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')
    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)

    const loadThemes = () => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getThemes')
                .then((fetchedThemes: ThemeInterface[]) => {
                    setThemes(fetchedThemes)
                })
                .catch(error =>
                    console.error('Ошибка при загрузке тем:', error),
                )
        }
    }

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags(prevTags =>
                new Set(prevTags).add(selectedTagFromURL),
            )
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadThemes()
    }, [])

    const reloadThemes = () => {
        setThemes([])
        loadThemes()
        toast.success('Темы перезагружены')
    }

    const handleCheckboxChange = (themeName: string, isChecked: boolean) => {
        const newTheme = isChecked ? themeName : 'Default'
        window.electron.store.set('theme', newTheme)
        setCurrentThemeName(newTheme)
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
        updatedTags.has(tag) ? updatedTags.delete(tag) : updatedTags.add(tag)
        setSelectedTags(updatedTags)
    }

    const filterAndSortThemes = (themeList: ThemeInterface[]) => {
        return themeList
            .filter(item => item.name !== 'Default')
            .map(item => ({
                ...item,
                matches:
                    item.name.toLowerCase().includes(searchQuery) ||
                    item.author.toLowerCase().includes(searchQuery) ||
                    stringSimilarity.compareTwoStrings(
                        item.name.toLowerCase(),
                        searchQuery,
                    ) > 0.35 ||
                    stringSimilarity.compareTwoStrings(
                        item.author.toLowerCase(),
                        searchQuery,
                    ) > 0.35,
            }))
            .sort((a, b) => (a.matches === b.matches ? 0 : a.matches ? -1 : 1))
    }

    const filterThemesByTags = (
        themeList: ThemeInterface[],
        tags: Set<string>,
    ) => {
        if (tags.size === 0) return themeList
        return themeList.filter(item => item.tags?.some(tag => tags.has(tag)))
    }

    const getFilteredThemes = (themeType: string) => {
        const filtered = filterAndSortThemes(
            filterThemesByTags(themes, selectedTags),
        )
        return themeType === currentThemeName
            ? filtered.filter(item => item.name === currentThemeName)
            : filtered.filter(item => item.name !== currentThemeName)
    }

    const enabledThemes = getFilteredThemes(currentThemeName)
    const disabledThemes = getFilteredThemes('other')
    const filteredEnabledThemes = hideEnabled ? [] : enabledThemes
    const filteredDisabledThemes = hideEnabled ? disabledThemes : disabledThemes

    const allTags = Array.from(new Set(themes.flatMap(item => item.tags || [])))
    const tagCounts = allTags.reduce(
        (acc, tag) => {
            acc[tag] = themes.filter(item => item.tags?.includes(tag)).length
            return acc
        },
        {} as Record<string, number>,
    )

    const filterThemes = (themeList: ThemeInterface[]) => {
        return themeList
            .filter(
                item =>
                    item.name.toLowerCase() !== 'default' &&
                    (item.name.toLowerCase().includes(searchQuery) ||
                        item.author.toLowerCase().includes(searchQuery) ||
                        stringSimilarity.compareTwoStrings(
                            item.name.toLowerCase(),
                            searchQuery,
                        ) > 0.35 ||
                        stringSimilarity.compareTwoStrings(
                            item.author.toLowerCase(),
                            searchQuery,
                        ) > 0.35),
            )
            .sort((a, b) => (a.name < b.name ? -1 : 1))
    }

    const filteredThemes = filterThemes(themes)

    useEffect(() => {
        setMaxThemeCount(prevCount =>
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

    const handleColumnsChange = (columns: number) => {
        setColumnsCount(columns)
    }

    const showFilter = () => setFilterVisible(true)
    const hideFilter = () => setFilterVisible(false)

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
            },
        },
    }

    const itemVariants = {
        hidden: { opacity: 0, y: 40 },
        visible: { opacity: 1, y: 0 },
    }

    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={extensionStyles.toolbar}>
                            <div className={extensionStyles.containerToolbar}>
                                <div
                                    className={extensionStyles.searchContainer}
                                >
                                    <SearchImg />
                                    <input
                                        className={extensionStyles.searchInput}
                                        type="text"
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        placeholder="Введите название расширения"
                                    />
                                    {filteredThemes.length > 0 &&
                                        filteredThemes.length <
                                            maxThemeCount && (
                                            <div
                                                className={
                                                    extensionStyles.searchLabel
                                                }
                                            >
                                                Найдено: {filteredThemes.length}
                                            </div>
                                        )}
                                    {filteredThemes.length === 0 && (
                                        <div
                                            className={
                                                extensionStyles.searchLabel
                                            }
                                        >
                                            Ничего не найдено
                                        </div>
                                    )}
                                </div>
                                <button
                                    className={extensionStyles.toolbarButton}
                                    onClick={() =>
                                        window.desktopEvents.send('openPath', {
                                            action: 'themePath',
                                        })
                                    }
                                >
                                    <FileImg />
                                </button>
                                <button
                                    className={`${extensionStyles.toolbarButton} ${extensionStyles.refreshButton}`}
                                    onClick={reloadThemes}
                                >
                                    <ArrowRefreshImg />
                                </button>
                                <button
                                    className={`${extensionStyles.toolbarButton} ${
                                        filterVisible
                                            ? extensionStyles.toolbarButtonActive
                                            : ''
                                    }`}
                                    onMouseEnter={showFilter}
                                >
                                    <FilterImg />
                                    {activeTagCount > 0 && (
                                        <div className={extensionStyles.count}>
                                            {activeTagCount > 9
                                                ? '9+'
                                                : activeTagCount}
                                        </div>
                                    )}
                                </button>
                            </div>
                            {filterVisible && (
                                <div
                                    className={extensionStyles.containerSearch}
                                    onMouseLeave={hideFilter}
                                >
                                    <div
                                        className={extensionStyles.tagsSection}
                                    >
                                        <div
                                            className={
                                                extensionStyles.tagsLabel
                                            }
                                        >
                                            Колонки:{' '}
                                        </div>
                                        <div
                                            className={
                                                extensionStyles.tagsContainer
                                            }
                                        >
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
                                                            ? extensionStyles.selectedTag
                                                            : ''
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div
                                        className={extensionStyles.tagsSection}
                                    >
                                        <div
                                            className={
                                                extensionStyles.tagsLabel
                                            }
                                        >
                                            Tags
                                        </div>
                                        <div
                                            className={
                                                extensionStyles.tagsContainer
                                            }
                                        >
                                            <CustomCheckbox
                                                checked={hideEnabled}
                                                onChange={
                                                    handleHideEnabledChange
                                                }
                                                label="Скрыть включенные"
                                                className={
                                                    hideEnabled
                                                        ? extensionStyles.selectedTag
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
                                                            ? extensionStyles.selectedTag
                                                            : ''
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className={globalStyles.container30x15}>
                            <div className={extensionStyles.preview}>
                                {filteredEnabledThemes.length > 0 && (
                                    <div
                                        className={
                                            extensionStyles.previewSelection
                                        }
                                    >
                                        <div
                                            className={
                                                extensionStyles.selectionContainerLable
                                            }
                                        >
                                            <div
                                                className={
                                                    extensionStyles.labelSelection
                                                }
                                            >
                                                Enable
                                            </div>
                                            <div
                                                className={extensionStyles.line}
                                            ></div>
                                        </div>
                                        <motion.div
                                            className={extensionStyles.grid}
                                            style={{
                                                gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                            }}
                                            variants={containerVariants}
                                            initial="hidden"
                                            animate="visible"
                                        >
                                            {filteredEnabledThemes.map(item => (
                                                <motion.div
                                                    key={item.name}
                                                    variants={itemVariants}
                                                >
                                                    <ExtensionCard
                                                        theme={item}
                                                        isChecked={true}
                                                        onCheckboxChange={
                                                            handleCheckboxChange
                                                        }
                                                        className={
                                                            item.matches
                                                                ? 'highlight'
                                                                : 'dimmed'
                                                        }
                                                    />
                                                </motion.div>
                                            ))}
                                        </motion.div>
                                    </div>
                                )}
                                {filteredDisabledThemes.length > 0 && (
                                    <div
                                        className={
                                            extensionStyles.previewSelection
                                        }
                                    >
                                        <div
                                            className={
                                                extensionStyles.selectionContainerLable
                                            }
                                        >
                                            <div
                                                className={
                                                    extensionStyles.labelSelection
                                                }
                                            >
                                                Disable
                                            </div>
                                            <div
                                                className={extensionStyles.line}
                                            ></div>
                                        </div>
                                        <motion.div
                                            className={extensionStyles.grid}
                                            style={{
                                                gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                            }}
                                            variants={containerVariants}
                                            initial="hidden"
                                            animate="visible"
                                        >
                                            {filteredDisabledThemes.map(
                                                item => (
                                                    <motion.div
                                                        key={item.name}
                                                        variants={itemVariants}
                                                    >
                                                        <ExtensionCard
                                                            theme={item}
                                                            isChecked={false}
                                                            onCheckboxChange={
                                                                handleCheckboxChange
                                                            }
                                                            className={
                                                                item.matches
                                                                    ? 'highlight'
                                                                    : 'dimmed'
                                                            }
                                                        />
                                                    </motion.div>
                                                ),
                                            )}
                                        </motion.div>
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
