import React, { useContext, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as extensionStyles from './extension.module.scss'
import ExtensionCard from '../../components/extensionCard'
import AddonInterface from '../../api/interfaces/addon.interface'
import stringSimilarity from 'string-similarity'
import CustomCheckbox from '../../components/checkbox_props'
import toast from '../../components/toast'
import userContext from '../../api/context/user.context'
import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileAddImg from './../../../../static/assets/stratis-icons/file-add.svg'
import MoreImg from './../../../../static/assets/stratis-icons/more.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'
import FilterImg from './../../../../static/assets/stratis-icons/filter.svg'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'

export default function ExtensionPage() {
    const [currentAddonName, setCurrentAddonName] = useState(
        window.electron.store.get('addons.theme') || 'Default',
    )
    const { addons, setAddons } = useContext(userContext)
    const [maxAddonCount, setMaxAddonCount] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const [hideEnabled, setHideEnabled] = useState(
        window.electron.store.get('addons.hideEnabled') || false,
    )
    const [filterVisible, setFilterVisible] = useState(false)
    const [optionMenu, setOptionMenu] = useState(false)

    const filterButtonRef = useRef<HTMLButtonElement>(null)
    const optionButtonRef = useRef<HTMLButtonElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [selectedTags, setSelectedTags] = useState<Set<string>>(
        new Set(window.electron.store.get('addons.selectedTags') || []),
    )
    const [columnsCount, setColumnsCount] = useState(
        window.electron.store.get('addons.columnsCount') || 3,
    )

    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')
    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)

    const loadAddons = () => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getAddons')
                .then((fetchedAddons: AddonInterface[]) => {
                    setAddons(fetchedAddons)
                })
                .catch((error) =>
                    console.error('Ошибка при загрузке аддонов:', error),
                )
        }
    }

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags((prevTags) => {
                const copy = new Set(prevTags)
                copy.add(selectedTagFromURL)
                return copy
            })
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadAddons()
    }, [])

    const reloadAddons = () => {
        setAddons([])
        loadAddons()
        toast.custom('success', 'Сделано', 'Расширения перезагружены')
    }

    const handleCheckboxChange = (addonName: string, isChecked: boolean) => {
        const newAddon = isChecked ? addonName : 'Default'
        window.electron.store.set('addons.theme', newAddon)
        setCurrentAddonName(newAddon)

        window.desktopEvents?.send('themeChanged', 'Default')
        window.desktopEvents?.send('themeChanged', newAddon)
    }

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(event.target.value.toLowerCase())
    }

    const handleHideEnabledChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setHideEnabled(event.target.checked)
    }

    const handleTagChange = (tag: string) => {
        const updatedTags = new Set(selectedTags)
        updatedTags.has(tag) ? updatedTags.delete(tag) : updatedTags.add(tag)
        setSelectedTags(updatedTags)
    }

    const filterAndSortAddons = (themeList: AddonInterface[]) => {
        return themeList
            .filter((item) => item.name !== 'Default')
            .map((item) => ({
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

    const filterAddonsByTags = (addonList: AddonInterface[], tags: Set<string>) => {
        if (tags.size === 0) return addonList
        return addonList.filter((item) => item.tags?.some((tag) => tags.has(tag)))
    }

    const getFilteredAddons = (themeType: string) => {
        const filtered = filterAndSortAddons(
            filterAddonsByTags(addons, selectedTags),
        )
        return themeType === currentAddonName
            ? filtered.filter((item) => item.name === currentAddonName)
            : filtered.filter((item) => item.name !== currentAddonName)
    }

    const enabledAddons = getFilteredAddons(currentAddonName)
    const disabledAddons = getFilteredAddons('other')
    const filteredEnabledAddons = hideEnabled ? [] : enabledAddons
    const filteredDisabledAddons = hideEnabled ? disabledAddons : disabledAddons

    const allTags = Array.from(new Set(addons.flatMap((item) => item.tags || [])))

    const tagCounts = allTags.reduce(
        (acc, tag) => {
            acc[tag] = addons.filter((item) => item.tags?.includes(tag)).length
            return acc
        },
        {} as Record<string, number>,
    )

    const getMergedSortedAddons = () => {
        let filtered = filterAddonsByTags(addons, selectedTags)
        filtered = filterAndSortAddons(filtered)

        if (hideEnabled) {
            filtered = filtered.filter((item) => item.name !== currentAddonName)
        }

        filtered.sort((a, b) => {
            const aEnabled = a.name === currentAddonName
            const bEnabled = b.name === currentAddonName
            if (aEnabled && !bEnabled) return -1
            if (!aEnabled && bEnabled) return 1
            return 0
        })

        return filtered
    }

    const mergedAddons = getMergedSortedAddons()

    useEffect(() => {
        setMaxAddonCount((prev) => Math.max(prev, mergedAddons.length))
    }, [mergedAddons])

    useEffect(() => {
        window.electron.store.set('addons.selectedTags', Array.from(selectedTags))
        window.electron.store.set('addons.columnsCount', columnsCount)
        window.electron.store.set('addons.hideEnabled', hideEnabled)
    }, [selectedTags, columnsCount, hideEnabled])

    const handleColumnsChange = (columns: number) => {
        setColumnsCount(columns)
    }

    const toggleMenu = (menu: 'filter' | 'option') => {
        if (menu === 'filter') {
            setFilterVisible((prev) => {
                if (!prev) setOptionMenu(false)
                return !prev
            })
        } else if (menu === 'option') {
            setOptionMenu((prev) => {
                if (!prev) setFilterVisible(false)
                return !prev
            })
        }
    }

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node
            if (
                containerRef.current &&
                !containerRef.current.contains(target) &&
                filterButtonRef.current &&
                !filterButtonRef.current.contains(target) &&
                optionButtonRef.current &&
                !optionButtonRef.current.contains(target)
            ) {
                setOptionMenu(false)
                setFilterVisible(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={extensionStyles.toolbar}>
                            <div className={extensionStyles.containerToolbar}>
                                <div className={extensionStyles.searchContainer}>
                                    <SearchImg />
                                    <input
                                        className={extensionStyles.searchInput}
                                        type="text"
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        placeholder="Введите название расширения"
                                    />
                                    {mergedAddons.length > 0 &&
                                        mergedAddons.length < maxAddonCount && (
                                            <div
                                                className={
                                                    extensionStyles.searchLabel
                                                }
                                            >
                                                Найдено: {mergedAddons.length}
                                            </div>
                                        )}
                                    {mergedAddons.length === 0 && (
                                        <div className={extensionStyles.searchLabel}>
                                            Ничего не найдено
                                        </div>
                                    )}
                                </div>
                                <button
                                    ref={optionButtonRef}
                                    className={`${extensionStyles.toolbarButton} ${
                                        optionMenu
                                            ? extensionStyles.toolbarButtonActive
                                            : ''
                                    }`}
                                    onClick={() => toggleMenu('option')}
                                >
                                    <MoreImg />
                                </button>
                                {optionMenu && (
                                    <div
                                        className={extensionStyles.containerOtional}
                                        ref={containerRef}
                                    >
                                        <button
                                            className={`${extensionStyles.toolbarButton} ${extensionStyles.refreshButton}`}
                                            onClick={reloadAddons}
                                        >
                                            <ArrowRefreshImg /> Перезагрузить
                                            расширения
                                        </button>
                                        <button
                                            className={extensionStyles.toolbarButton}
                                            onClick={() =>
                                                window.desktopEvents?.send(
                                                    'openPath',
                                                    { action: 'themePath' },
                                                )
                                            }
                                        >
                                            <FileImg /> Директория аддонов
                                        </button>
                                        <button
                                            className={extensionStyles.toolbarButton}
                                            onClick={() =>
                                                window.desktopEvents
                                                    .invoke('create-new-extension')
                                                    .then((res) => {
                                                        if (res.success) {
                                                            toast.custom(
                                                                'success',
                                                                'Вжух!',
                                                                'Новое расширение создано: ' +
                                                                    res.name,
                                                            )
                                                            setAddons([])
                                                            loadAddons()
                                                        }
                                                    })
                                            }
                                        >
                                            <FileAddImg /> Создать новое расширение
                                        </button>
                                    </div>
                                )}
                                <button
                                    ref={filterButtonRef}
                                    className={`${extensionStyles.toolbarButton} ${
                                        filterVisible
                                            ? extensionStyles.toolbarButtonActive
                                            : ''
                                    }`}
                                    onClick={() => toggleMenu('filter')}
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
                                    className={extensionStyles.containerFilter}
                                    ref={containerRef}
                                >
                                    <div className={extensionStyles.tagsSection}>
                                        <div className={extensionStyles.tagsLabel}>
                                            Колонки:{' '}
                                        </div>
                                        <div
                                            className={extensionStyles.tagsContainer}
                                        >
                                            {[2, 3, 4].map((count) => (
                                                <CustomCheckbox
                                                    key={count}
                                                    checked={columnsCount === count}
                                                    onChange={() =>
                                                        handleColumnsChange(count)
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
                                    <div className={extensionStyles.tagsSection}>
                                        <div className={extensionStyles.tagsLabel}>
                                            Tags
                                        </div>
                                        <div
                                            className={extensionStyles.tagsContainer}
                                        >
                                            <CustomCheckbox
                                                checked={hideEnabled}
                                                onChange={handleHideEnabledChange}
                                                label="Скрыть включённые"
                                                className={
                                                    hideEnabled
                                                        ? extensionStyles.selectedTag
                                                        : ''
                                                }
                                            />
                                            {allTags.map((tag) => (
                                                <CustomCheckbox
                                                    key={tag}
                                                    checked={selectedTags.has(tag)}
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
                                <div className={extensionStyles.previewSelection}>
                                    <div
                                        className={extensionStyles.grid}
                                        style={{
                                            gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                        }}
                                    >
                                        {mergedAddons.map((item) => {
                                            const checked =
                                                item.name === currentAddonName
                                            return (
                                                <ExtensionCard
                                                    key={item.name}
                                                    theme={item}
                                                    isChecked={checked}
                                                    onCheckboxChange={
                                                        handleCheckboxChange
                                                    }
                                                    className={
                                                        item.matches
                                                            ? 'highlight'
                                                            : 'dimmed'
                                                    }
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
