import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'

import { MdCheckCircle, MdColorLens, MdFilterList, MdMoreHoriz, MdTextSnippet } from 'react-icons/md'
import stringSimilarity from 'string-similarity'

import userContext from '../../api/context/user.context'
import Addon from '../../api/interfaces/addon.interface'

import toast from '../../components/toast'

import Layout from '../../components/layout'
import ContainerV2 from '../../components/containerV2'
import Scrollbar from '../../components/PSUI/Scrollbar'
import AddonFilters from '../../components/PSUI/AddonFilters'
import OptionMenu from '../../components/PSUI/OptionMenu'

import ExtensionView from './route/extensionview'

import * as extensionStylesV2 from './extension.module.scss'
import * as styles from '../../../../static/styles/page/index.module.scss'
import addonInitials from '../../api/initials/addon.initials'

import config from '../../api/config'

export default function ExtensionPage() {
    const { addons, setAddons } = useContext(userContext)
    const [currentTheme, setCurrentTheme] = useState(window.electron.store.get('addons.theme') || 'Default')
    const [enabledScripts, setEnabledScripts] = useState<string[]>(window.electron.store.get('addons.scripts') || [])
    const [searchQuery, setSearchQuery] = useState('')
    const [hideEnabled, setHideEnabled] = useState(window.electron.store.get('addons.hideEnabled') || false)
    const [selectedAddon, setSelectedAddon] = useState<Addon | null>(null)
    const [isListFullyLoaded, setIsListFullyLoaded] = useState(false)
    const filterButtonRef = useRef<HTMLButtonElement>(null)
    const optionButtonRef = useRef<HTMLButtonElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [displayedCount, setDisplayedCount] = useState(0)
    const [optionMenu, setOptionMenu] = useState(false)
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

    const [showFilters, setShowFilters] = useState(false)
    const [sort, setSort] = useState<'alphabet' | 'date' | 'size' | 'author' | 'type'>('type')
    const [type, setType] = useState<'all' | 'theme' | 'script'>('all')
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
    const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set())

    const [imageCache, setImageCache] = useState<Record<string, string>>({})

    const previewCache = new Map<string, string>()

    type SortKey = keyof typeof defaultOrder

    const defaultOrder = {
        alphabet: 'asc',
        author: 'asc',
        date: 'asc',
        size: 'desc',
        type: 'asc',
    } as const

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
                setShowFilters(false)
                setOptionMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    const loadAddons = () => {
        window.desktopEvents
            ?.invoke('getAddons')
            .then((fetchedAddons: Addon[]) => {
                const filtered = fetchedAddons.filter(a => a.name !== 'Default')
                setAddons(filtered)
            })
            .catch(error => console.error('Ошибка при загрузке аддонов:', error))
    }

    useEffect(() => {
        loadAddons()
    }, [])

    const handleCheckboxChange = (addon: Addon, newChecked: boolean) => {
        if (addon.type === 'theme') {
            if (newChecked) {
                setCurrentTheme(addon.directoryName)
                window.electron.store.set('addons.theme', addon.directoryName)
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                window.desktopEvents?.send('themeChanged', addon)
                toast.custom('success', 'Тема активирована', `${addon.name} теперь активна`)
            } else {
                setCurrentTheme('Default')
                window.electron.store.set('addons.theme', 'Default')
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                toast.custom('info', 'Тема деактивирована', 'Установлена тема по умолчанию')
            }
        } else {
            const updated = newChecked ? [...enabledScripts, addon.directoryName] : enabledScripts.filter(name => name !== addon.directoryName)
            toast.custom(
                newChecked ? 'success' : 'info',
                newChecked ? 'Скрипт включен' : 'Скрипт выключен',
                `${addon.name} ${newChecked ? 'теперь активен' : 'деактивирован'}`,
            )
            setEnabledScripts(updated)
        }
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value.toLowerCase())
    }

    const handleTypeChange = (newType: 'all' | 'theme' | 'script') => {
        setType(newType)
    }

    const toggleSet = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
        const newSet = new Set(set)
        if (newSet.has(value)) {
            newSet.delete(value)
        } else {
            newSet.add(value)
        }
        setter(newSet)
    }

    const handleSortChange = (option: SortKey) => {
        if (option === sort) {
            setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
        } else {
            setSort(option)
            setSortOrder(defaultOrder[option])
        }
    }

    const mergedAddons = useMemo(() => {
        let result = addons.filter(a => a.name !== 'Default')
        if (type !== 'all') {
            result = result.filter(addon => addon.type === type)
        }

        if (selectedTags.size > 0) {
            result = result.filter(addon => addon.tags?.some(tag => selectedTags.has(tag)))
        }

        if (selectedCreators.size > 0) {
            result = result.filter(addon => typeof addon.author === 'string' && selectedCreators.has(addon.author))
        }

        if (searchQuery.trim()) {
            result = result.filter(item => {
                const authorString =
                    typeof item.author === 'string'
                        ? item.author.toLowerCase()
                        : Array.isArray(item.author)
                          ? item.author.map(id => String(id).toLowerCase()).join(', ')
                          : ''

                let matches = item.name.toLowerCase().includes(searchQuery) || authorString.includes(searchQuery)

                if (!matches && searchQuery.length > 2) {
                    matches =
                        stringSimilarity.compareTwoStrings(item.name.toLowerCase(), searchQuery) > 0.35 ||
                        stringSimilarity.compareTwoStrings(authorString, searchQuery) > 0.35
                }

                return matches
            })
        }

        switch (sort) {
            case 'type':
                result.sort((a, b) => {
                    const typeA = a.type || ''
                    const typeB = b.type || ''
                    const cmp = typeA.localeCompare(typeB)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
            case 'alphabet':
                result.sort((a, b) => {
                    const cmp = a.name.localeCompare(b.name)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
            case 'date':
                result.sort((a, b) => {
                    const dateA = parseFloat(a.lastModified || '0') || 0
                    const dateB = parseFloat(b.lastModified || '0') || 0
                    return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
                })
                break
            case 'size':
                result.sort((a, b) => {
                    const sizeA = parseFloat(a.size || '0') || 0
                    const sizeB = parseFloat(b.size || '0') || 0
                    return sortOrder === 'asc' ? sizeA - sizeB : sizeB - sizeA
                })
                break
            case 'author':
                result.sort((a, b) => {
                    const authorA = typeof a.author === 'string' ? a.author : ''
                    const authorB = typeof b.author === 'string' ? b.author : ''
                    const cmp = authorA.localeCompare(authorB)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
        }

        if (hideEnabled) {
            result = result.filter(addon =>
                addon.type === 'theme' ? addon.directoryName !== currentTheme : !enabledScripts.includes(addon.directoryName),
            )
        }

        return result
    }, [addons, type, selectedTags, selectedCreators, searchQuery, sort, sortOrder, hideEnabled, currentTheme, enabledScripts])

    useEffect(() => {
        const fetchImages = async () => {
            const updates: Record<string, string> = {}

            await Promise.all(
                mergedAddons.map(async addon => {
                    if (!addon.image) return

                    if (previewCache.has(addon.directoryName) || imageCache[addon.directoryName]) return

                    const url =
                        `http://127.0.0.1:${config.MAIN_PORT}/addon_file` +
                        `?name=${encodeURIComponent(addon.name)}` +
                        `&file=${encodeURIComponent(addon.image)}`
                    try {
                        const res = await fetch(url)
                        if (!res.ok) throw new Error('404')
                        const blobUrl = URL.createObjectURL(await res.blob())
                        previewCache.set(addon.directoryName, blobUrl)
                        updates[addon.directoryName] = blobUrl
                    } catch (e) {
                        previewCache.set(addon.directoryName, 'static/assets/images/no_themeImage.png')
                    }
                }),
            )

            if (Object.keys(updates).length) {
                setImageCache(prev => ({ ...prev, ...updates }))
            }
        }

        fetchImages()
    }, [mergedAddons, imageCache])

    useEffect(() => {
        if (searchQuery.trim()) {
            setDisplayedCount(mergedAddons.length)
            setIsListFullyLoaded(true)
        } else {
            setDisplayedCount(0)
            if (mergedAddons.length > 0) {
                const interval = setInterval(() => {
                    setDisplayedCount(prev => {
                        if (prev < mergedAddons.length) return prev + 1
                        clearInterval(interval)
                        setIsListFullyLoaded(true)
                        return prev
                    })
                }, 0)
                return () => clearInterval(interval)
            }
        }
    }, [mergedAddons, searchQuery])

    useEffect(() => {
        if (!selectedAddon && isListFullyLoaded) {
            const activeAddon = mergedAddons.find(addon =>
                addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName),
            )
            setSelectedAddon(activeAddon || mergedAddons[0])
        }
    }, [currentTheme, enabledScripts, mergedAddons, isListFullyLoaded, selectedAddon])

    const handleAddonClick = (addon: Addon) => setSelectedAddon(addon)

    const toggleFilterPanel = () => {
        setShowFilters(prev => !prev)
        setOptionMenu(false)
    }

    const toggleOptionMenu = () => {
        setOptionMenu(prev => !prev)
        setShowFilters(false)
    }

    const isValidPath = (path: string) => typeof path === 'string' && path.trim() !== ''
    const isValidImage = (image: string) => typeof image === 'string' && image.trim() !== ''

    const getImagePath = (addon: Addon, cache: Record<string, string>) => {
        if (!addon.image) return 'static/assets/images/no_themeImage.png'

        // 1️⃣ HTTP / data URI уже готов – отдаём как есть
        if (/^(https?:\/\/|data:)/i.test(addon.image.trim())) return addon.image

        // 2️⃣ Если превью уже скачано – используем кэш
        if (cache[addon.directoryName]) return cache[addon.directoryName]

        // 3️⃣ Пока нет превью – временно заглушка
        return 'static/assets/images/no_themeImage.png'
    }

    const handleReloadAddons = () => {
        loadAddons()
        toast.custom('info', 'Информация', 'Аддоны перезагружены')
    }

    const handleOpenAddonsDirectory = () => {
        window.desktopEvents?.send('openPath', { action: 'themePath' })
    }

    const handleCreateNewAddon = () => {
        window.desktopEvents.invoke('create-new-extension').then(res => {
            if (res.success) {
                toast.custom('success', 'Вжух!', 'Новое расширение создано: ' + res.name)
                setAddons([])
                loadAddons()
            }
        })
    }

    const enabled = mergedAddons.filter(addon =>
        addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName),
    )

    const disabled = mergedAddons.filter(
        addon => !(addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)),
    )

    return (
        <Layout title="Аддоны">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <ContainerV2 titleName="Addons" imageName="extension" />
                        <div ref={containerRef}>
                            {showFilters && (
                                <AddonFilters
                                    tags={Array.from(new Set(addons.filter(ad => ad.name !== 'Default').flatMap(ad => ad.tags || [])))}
                                    creators={Array.from(
                                        new Set(
                                            addons
                                                .filter(ad => ad.name !== 'Default')
                                                .map(ad => (typeof ad.author === 'string' && ad.author.trim() !== '' ? ad.author : null))
                                                .filter((a): a is string => a !== null),
                                        ),
                                    )}
                                    sort={sort}
                                    sortOrder={sortOrder}
                                    type={type}
                                    selectedTags={selectedTags}
                                    selectedCreators={selectedCreators}
                                    onSortChange={handleSortChange}
                                    onTypeChange={handleTypeChange}
                                    onToggleTag={tag => toggleSet(selectedTags, tag, setSelectedTags)}
                                    onToggleCreator={creator => toggleSet(selectedCreators, creator, setSelectedCreators)}
                                    setType={setType}
                                    setSelectedTags={setSelectedTags}
                                    setSelectedCreators={setSelectedCreators}
                                    onSortOrderChange={setSortOrder}
                                />
                            )}
                            {optionMenu && (
                                <OptionMenu
                                    onReloadAddons={handleReloadAddons}
                                    onOpenAddonsDirectory={handleOpenAddonsDirectory}
                                    onCreateNewAddon={handleCreateNewAddon}
                                />
                            )}
                        </div>
                        <div className={extensionStylesV2.container}>
                            <Scrollbar className={extensionStylesV2.leftSide} classNameInner={extensionStylesV2.leftSideInner}>
                                <div className={extensionStylesV2.topContainer}>
                                    <div className={extensionStylesV2.searchContainer}>
                                        <input
                                            type="text"
                                            placeholder="Поиск..."
                                            value={searchQuery}
                                            onChange={handleSearchChange}
                                            className={extensionStylesV2.searchInput}
                                        />
                                        <button
                                            ref={filterButtonRef}
                                            className={extensionStylesV2.filterButton}
                                            style={showFilters ? { background: '#98FFD6', color: '#181818' } : undefined}
                                            onClick={toggleFilterPanel}
                                        >
                                            <MdFilterList />
                                            {(() => {
                                                const activeFiltersCount =
                                                    (type !== 'all' ? 1 : 0) + (sort !== 'type' ? 1 : 0) + selectedTags.size + selectedCreators.size

                                                return (
                                                    activeFiltersCount > 0 && (
                                                        <div className={extensionStylesV2.count}>
                                                            {activeFiltersCount > 9 ? '9+' : activeFiltersCount}
                                                        </div>
                                                    )
                                                )
                                            })()}
                                        </button>
                                    </div>
                                    <button
                                        ref={optionButtonRef}
                                        className={`${extensionStylesV2.optionsButton} ${optionMenu ? extensionStylesV2.optionsButtonActive : ''}`}
                                        style={optionMenu ? { background: '#98FFD6', color: '#181818' } : undefined}
                                        onClick={toggleOptionMenu}
                                    >
                                        <MdMoreHoriz />
                                    </button>
                                </div>
                                <div className={extensionStylesV2.addonList}>
                                    <div className={extensionStylesV2.enabledAddons}>
                                        {mergedAddons
                                            .filter(addon =>
                                                addon.type === 'theme'
                                                    ? addon.directoryName === currentTheme
                                                    : enabledScripts.includes(addon.directoryName),
                                            )
                                            .map(addon => (
                                                <div
                                                    key={addon.name}
                                                    className={`${extensionStylesV2.addonCard} ${
                                                        selectedAddon === addon ? extensionStylesV2.addonCardSelected : ''
                                                    }`}
                                                    onClick={() => handleAddonClick(addon)}
                                                >
                                                    <div
                                                        className={`${extensionStylesV2.checkSelect} ${
                                                            addon.type === 'theme'
                                                                ? extensionStylesV2.checkMarkTheme
                                                                : extensionStylesV2.checkMarkScript
                                                        }`}
                                                        style={{
                                                            marginRight: '12px',
                                                            opacity: 1,
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            handleCheckboxChange(
                                                                addon,
                                                                !(addon.type === 'theme'
                                                                    ? addon.directoryName === currentTheme
                                                                    : enabledScripts.includes(addon.directoryName)),
                                                            )
                                                        }}
                                                    >
                                                        <MdCheckCircle size={18} />
                                                    </div>
                                                    <img
                                                        src={getImagePath(addon, imageCache)}
                                                        alt={addon.name}
                                                        className={extensionStylesV2.addonImage}
                                                        loading="lazy"
                                                    />
                                                    <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                    {enabled.length > 0 && disabled.length > 0 && <div className={extensionStylesV2.line}></div>}
                                    {enabled.length === 0 && disabled.length === 0 && (
                                        <div className={extensionStylesV2.noFix}>
                                            <div className={extensionStylesV2.noResults}>Ничего не найдено</div>
                                        </div>
                                    )}
                                    <div className={extensionStylesV2.disabledAddons}>
                                        {mergedAddons
                                            .filter(
                                                addon =>
                                                    !(addon.type === 'theme'
                                                        ? addon.directoryName === currentTheme
                                                        : enabledScripts.includes(addon.directoryName)),
                                            )
                                            .map(addon => (
                                                <div
                                                    key={addon.name}
                                                    className={`${extensionStylesV2.addonCard} ${
                                                        selectedAddon === addon ? extensionStylesV2.addonCardSelected : ''
                                                    }`}
                                                    onClick={() => handleAddonClick(addon)}
                                                >
                                                    <div
                                                        className={`${extensionStylesV2.checkSelect} ${
                                                            addon.type === 'theme'
                                                                ? extensionStylesV2.checkMarkTheme
                                                                : extensionStylesV2.checkMarkScript
                                                        }`}
                                                        style={{ color: '#565F77' }}
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            handleCheckboxChange(
                                                                addon,
                                                                !(addon.type === 'theme'
                                                                    ? addon.directoryName === currentTheme
                                                                    : enabledScripts.includes(addon.directoryName)),
                                                            )
                                                        }}
                                                    >
                                                        <MdCheckCircle size={18} />
                                                    </div>
                                                    <img
                                                        src={getImagePath(addon, imageCache)}
                                                        alt={addon.name}
                                                        className={extensionStylesV2.addonImage}
                                                        loading="lazy"
                                                    />
                                                    <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            </Scrollbar>
                            <div className={extensionStylesV2.rightSide}>
                                {selectedAddon && (
                                    <ExtensionView
                                        addon={selectedAddon}
                                        isEnabled={
                                            selectedAddon.type === 'theme'
                                                ? selectedAddon.directoryName === currentTheme
                                                : enabledScripts.includes(selectedAddon.directoryName)
                                        }
                                        onToggleEnabled={enabled => handleCheckboxChange(selectedAddon, enabled)}
                                        setSelectedTags={setSelectedTags}
                                        setShowFilters={setShowFilters}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
