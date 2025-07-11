import React, { useContext, useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as extensionStyles from './extension.module.scss'
import ExtensionCard from '../../components/extensionCard'
import Addon from '../../api/interfaces/addon.interface'
import stringSimilarity from 'string-similarity'
import CustomCheckbox from '../../components/checkbox_props'
import toast from '../../components/toast'
import userContext from '../../api/context/user.context'

import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileAddImg from './../../../../static/assets/stratis-icons/file-add.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'

import MoreImg from './../../../../static/assets/stratis-icons/more.svg'
import FilterImg from './../../../../static/assets/stratis-icons/filter.svg'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'
import addonInitials from '../../api/initials/addon.initials'
import Skeleton from 'react-loading-skeleton'

function checkMissingFields(addon: Addon): string[] {
    const missing: string[] = []
    if (!addon.name) missing.push('name')
    if (!addon.author) missing.push('author')
    if (!addon.version) missing.push('version')
    if (!addon.image) missing.push('image')
    if (!addon.banner) missing.push('banner')
    if (!addon.type) missing.push('type')
    return missing
}

export default function ExtensionPage() {
    const { addons, setAddons } = useContext(userContext)

    const [currentTheme, setCurrentTheme] = useState<string>(window.electron.store.get('addons.theme') || 'Default')
    const [enabledScripts, setEnabledScripts] = useState<string[]>(window.electron.store.get('addons.scripts') || [])
    const [maxAddonCount, setMaxAddonCount] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const [hideEnabled, setHideEnabled] = useState<boolean>(window.electron.store.get('addons.hideEnabled') || false)
    const [filterVisible, setFilterVisible] = useState(false)
    const [optionMenu, setOptionMenu] = useState(false)

    const filterButtonRef = useRef<HTMLButtonElement>(null)
    const optionButtonRef = useRef<HTMLButtonElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set(window.electron.store.get('addons.selectedTags') || []))
    const [columnsCount, setColumnsCount] = useState<number>(window.electron.store.get('addons.columnsCount') || 3)
    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')

    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)
    const [displayedCount, setDisplayedCount] = useState(0)

    const loadAddons = useCallback(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getAddons')
                .then((fetchedAddons: Addon[]) => {
                    setAddons(fetchedAddons)
                })
                .catch(error => console.error('Ошибка при загрузке аддонов:', error))
        }
    }, [setAddons])

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags(prev => {
                const copy = new Set(prev)
                copy.add(selectedTagFromURL)
                return copy
            })
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadAddons()
    }, [loadAddons])

    useEffect(() => {
        window.electron.store.set('addons.scripts', enabledScripts)
    }, [enabledScripts])

    useEffect(() => {
        window.electron.store.set('addons.theme', currentTheme)
    }, [currentTheme])

    const reloadAddons = useCallback(() => {
        setAddons([])
        loadAddons()
        toast.custom('success', 'Сделано', 'Расширения перезагружены')
    }, [setAddons, loadAddons])

    const handleCheckboxChange = (addon: Addon, newChecked: boolean) => {
        if (addon.type === 'theme') {
            if (newChecked) {
                setCurrentTheme(addon.directoryName)
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                window.desktopEvents?.send('themeChanged', addon)
            } else {
                setCurrentTheme('Default')
                window.desktopEvents?.send('themeChanged', addonInitials[0])
            }
        } else {
            setEnabledScripts(prev => {
                if (newChecked) {
                    return prev.includes(addon.directoryName) ? prev : [...prev, addon.directoryName]
                }
                return prev.filter(scriptName => scriptName !== addon.directoryName)
            })
        }
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value.toLowerCase())
    }

    const handleHideEnabledChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setHideEnabled(e.target.checked)
    }

    const handleTagChange = (tag: string) => {
        setSelectedTags(prev => {
            const updated = new Set(prev)
            updated.has(tag) ? updated.delete(tag) : updated.add(tag)
            return updated
        })
    }

    const allTags = useMemo(() => {
        const tagSet = new Set<string>()
        for (const item of addons) {
            if (Array.isArray(item.tags)) {
                item.tags.forEach(t => tagSet.add(t))
            }
        }
        return Array.from(tagSet)
    }, [addons])

    const filterAndSortAddons = useCallback((list: Addon[], query: string) => {
        return list
            .filter(item => item.name !== 'Default')
            .map(item => {
                let authorString = ''
                if (typeof item.author === 'string') {
                    authorString = item.author.toLowerCase()
                } else if (Array.isArray(item.author)) {
                    authorString = item.author.map(id => String(id).toLowerCase()).join(', ')
                }
                let matches = false
                if (!query) {
                    matches = true
                } else {
                    matches = item.name.toLowerCase().includes(query) || authorString.includes(query)
                    if (!matches && query.length > 2) {
                        matches =
                            stringSimilarity.compareTwoStrings(item.name.toLowerCase(), query) > 0.35 ||
                            stringSimilarity.compareTwoStrings(authorString, query) > 0.35
                    }
                }
                return {
                    ...item,
                    matches,
                }
            })
            .sort((a, b) => {
                if (a.matches === b.matches) {
                    return 0
                }
                return a.matches ? -1 : 1
            })
    }, [])

    const filterAddonsByTags = useCallback((list: Addon[], tags: Set<string>) => {
        if (tags.size === 0) return list
        return list.filter(item => item.tags?.some(t => tags.has(t)))
    }, [])

    function getMissingCount(addon: Addon): number {
        return checkMissingFields(addon).length
    }

    function getPriority(addon: Addon): number {
        const missingCount = getMissingCount(addon)
        if (missingCount > 0) return 999
        const isTheme = addon.type === 'theme'
        const isEnabledTheme = isTheme && addon.directoryName === currentTheme
        if (isEnabledTheme) return 0
        const isScript = addon.type === 'script'
        const isEnabledScript = isScript && enabledScripts.includes(addon.directoryName)
        if (isEnabledScript) return 1
        return 2
    }

    const mergedAddons = useMemo(() => {
        let filtered = filterAddonsByTags(addons, selectedTags)
        filtered = filterAndSortAddons(filtered, searchQuery)

        if (hideEnabled) {
            filtered = filtered.filter(item => {
                if (item.type === 'theme') {
                    return item.directoryName !== currentTheme
                }
                return !enabledScripts.includes(item.directoryName)
            })
        }

        filtered.sort((a, b) => {
            const priA = getPriority(a)
            const priB = getPriority(b)
            if (priA !== priB) {
                return priA - priB
            }
            const aMatch = a.matches ? 1 : 0
            const bMatch = b.matches ? 1 : 0
            return bMatch - aMatch
        })

        return filtered
    }, [addons, selectedTags, searchQuery, hideEnabled, currentTheme, enabledScripts, filterAddonsByTags, filterAndSortAddons])

    const availableAddons = useMemo(() => addons.filter(addon => addon.name !== 'Default'), [addons])

    useEffect(() => {
        if (searchQuery.trim() !== '') {
            setDisplayedCount(mergedAddons.length)
            return
        }

        setDisplayedCount(0)
        if (mergedAddons.length > 0) {
            let count = 0
            const stepTime = 50
            const step = () => {
                count += 1
                setDisplayedCount(count)
                if (count < mergedAddons.length) {
                    setTimeout(step, stepTime)
                }
            }
            step()
        }
    }, [mergedAddons, searchQuery])

    useEffect(() => {
        window.electron.store.set('addons.selectedTags', Array.from(selectedTags))
        window.electron.store.set('addons.columnsCount', columnsCount)
        window.electron.store.set('addons.hideEnabled', hideEnabled)
    }, [selectedTags, columnsCount, hideEnabled])

    const handleColumnsChange = (n: number) => {
        setColumnsCount(n)
    }

    const toggleMenu = (menu: 'filter' | 'option') => {
        if (menu === 'filter') {
            setFilterVisible(prev => {
                if (!prev) setOptionMenu(false)
                return !prev
            })
        } else {
            setOptionMenu(prev => {
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
                                    {mergedAddons.length > 0 && mergedAddons.length < maxAddonCount && (
                                        <div className={extensionStyles.searchLabel}>Найдено: {mergedAddons.length}</div>
                                    )}
                                    {mergedAddons.length === 0 && <div className={extensionStyles.searchLabel}>Ничего не найдено</div>}
                                </div>

                                <button
                                    ref={optionButtonRef}
                                    className={`${extensionStyles.toolbarButton} ${optionMenu ? extensionStyles.toolbarButtonActive : ''}`}
                                    onClick={() => toggleMenu('option')}
                                >
                                    <MoreImg />
                                </button>

                                {optionMenu && (
                                    <div className={extensionStyles.containerOtional} ref={containerRef}>
                                        <button
                                            className={`${extensionStyles.toolbarButton} ${extensionStyles.refreshButton}`}
                                            onClick={reloadAddons}
                                        >
                                            <ArrowRefreshImg /> Перезагрузить расширения
                                        </button>
                                        <button
                                            className={extensionStyles.toolbarButton}
                                            onClick={() =>
                                                window.desktopEvents?.send('openPath', {
                                                    action: 'themePath',
                                                })
                                            }
                                        >
                                            <FileImg /> Директория аддонов
                                        </button>
                                        <button
                                            className={extensionStyles.toolbarButton}
                                            onClick={() =>
                                                window.desktopEvents.invoke('create-new-extension').then(res => {
                                                    if (res.success) {
                                                        toast.custom('success', 'Вжух!', 'Новое расширение создано: ' + res.name)
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
                                    className={`${extensionStyles.toolbarButton} ${filterVisible ? extensionStyles.toolbarButtonActive : ''}`}
                                    onClick={() => toggleMenu('filter')}
                                >
                                    <FilterImg />
                                    {activeTagCount > 0 && <div className={extensionStyles.count}>{activeTagCount > 9 ? '9+' : activeTagCount}</div>}
                                </button>
                            </div>

                            {filterVisible && (
                                <div className={extensionStyles.containerFilter} ref={containerRef}>
                                    <div className={extensionStyles.tagsSection}>
                                        <div className={extensionStyles.tagsLabel}>Колонки: </div>
                                        <div className={extensionStyles.tagsContainer}>
                                            {[2, 3, 4].map(count => (
                                                <CustomCheckbox
                                                    key={count}
                                                    checked={columnsCount === count}
                                                    onChange={() => handleColumnsChange(count)}
                                                    label={`${count} колонок`}
                                                    className={columnsCount === count ? extensionStyles.selectedTag : ''}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className={extensionStyles.tagsSection}>
                                        <div className={extensionStyles.tagsLabel}>Tags</div>
                                        <div className={extensionStyles.tagsContainer}>
                                            <CustomCheckbox
                                                checked={hideEnabled}
                                                onChange={handleHideEnabledChange}
                                                label="Скрыть включённые"
                                                className={hideEnabled ? extensionStyles.selectedTag : ''}
                                            />
                                            {allTags.map(tag => (
                                                <CustomCheckbox
                                                    key={tag}
                                                    checked={selectedTags.has(tag)}
                                                    onChange={() => handleTagChange(tag)}
                                                    label={tag}
                                                    className={selectedTags.has(tag) ? extensionStyles.selectedTag : ''}
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
                                    {availableAddons.length === 0 ? (
                                        <div className={extensionStyles.noThemes}>
                                            <div className={extensionStyles.noThemesText}>У вас нет установленных аддонов.</div>
                                            <div className={extensionStyles.noThemesText}>
                                                Зайдите в наш Discord, чтобы скачать аддоны:&nbsp;
                                                <a
                                                    className={extensionStyles.noThemesLink}
                                                    href="https://discord.gg/qy42uGTzRy"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    https://discord.gg/qy42uGTzRy
                                                </a>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className={extensionStyles.grid}
                                            style={{
                                                gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                            }}
                                        >
                                            {mergedAddons.map((addon, index) =>
                                                index < displayedCount ? (
                                                    <ExtensionCard
                                                        key={addon.name}
                                                        addon={addon}
                                                        isChecked={
                                                            addon.type === 'theme'
                                                                ? addon.directoryName === currentTheme
                                                                : enabledScripts.includes(addon.directoryName)
                                                        }
                                                        onCheckboxChange={(_unused, newIsChecked) => handleCheckboxChange(addon, newIsChecked)}
                                                        className={addon.matches ? 'highlight' : 'dimmed'}
                                                    />
                                                ) : (
                                                    <div key={`skeleton-${addon.name}`} className={extensionStyles.skeletonWrapper}>
                                                        <Skeleton
                                                            style={
                                                                columnsCount === 2
                                                                    ? { height: '336px' }
                                                                    : columnsCount === 3
                                                                      ? { height: '240px' }
                                                                      : { height: '192px' }
                                                            }
                                                        />
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
