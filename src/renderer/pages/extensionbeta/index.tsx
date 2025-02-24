// ExtensionPage.tsx

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
import addonInitials from '../../api/initials/addon.initials'

// Проверяет, какие поля в метаданных не заполнены
function checkMissingFields(addon: AddonInterface): string[] {
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

    // Храним «текущую» тему и список включённых скриптов
    const [currentTheme, setCurrentTheme] = useState(
        window.electron.store.get('addons.theme') || 'Default',
    )
    const [enabledScripts, setEnabledScripts] = useState<string[]>(
        window.electron.store.get('addons.scripts') || [],
    )

    // Прочие состояния для UI
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

    // Теги
    const [selectedTags, setSelectedTags] = useState<Set<string>>(
        new Set(window.electron.store.get('addons.selectedTags') || []),
    )

    // Число колонок в сетке
    const [columnsCount, setColumnsCount] = useState(
        window.electron.store.get('addons.columnsCount') || 3,
    )

    // Считываем query-параметр
    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')

    // Для отображения числа активных фильтров
    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)

    // Загрузка аддонов
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
            setSelectedTags((prev) => {
                const copy = new Set(prev)
                copy.add(selectedTagFromURL)
                return copy
            })
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadAddons()
    }, [])

    // Синхронизируем enabledScripts и theme с electron-store
    useEffect(() => {
        window.electron.store.set('addons.scripts', enabledScripts)
    }, [enabledScripts])

    useEffect(() => {
        window.electron.store.set('addons.theme', currentTheme)
    }, [currentTheme])

    // Кнопка «Перезагрузить расширения»
    const reloadAddons = () => {
        setAddons([])
        loadAddons()
        toast.custom('success', 'Сделано', 'Расширения перезагружены')
    }

    // Включение/выключение темы или скрипта
    const handleCheckboxChange = (addon: AddonInterface, newChecked: boolean) => {
        if (addon.type === 'theme') {
            if (newChecked) {
                // Включаем тему
                setCurrentTheme(addon.directoryName)
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                window.desktopEvents?.send('themeChanged', addon)
            } else {
                // Выключаем тему => Default
                setCurrentTheme('Default')
                window.desktopEvents?.send('themeChanged', addonInitials[0])
            }
        } else {
            // Скрипт
            if (newChecked) {
                setEnabledScripts((prev) => {
                    if (!prev.includes(addon.directoryName)) {
                        return [...prev, addon.directoryName]
                    }
                    return prev
                })
            } else {
                setEnabledScripts((prev) =>
                    prev.filter((scriptName) => scriptName !== addon.directoryName),
                )
            }
        }
    }

    // Поиск
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value.toLowerCase())
    }

    // Скрыть включённые
    const handleHideEnabledChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setHideEnabled(e.target.checked)
    }

    // Смена тега
    const handleTagChange = (tag: string) => {
        const updated = new Set(selectedTags)
        updated.has(tag) ? updated.delete(tag) : updated.add(tag)
        setSelectedTags(updated)
    }

    // Фильтруем по поиску
    function filterAndSortAddons(list: AddonInterface[]) {
        return list
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

    // Фильтрация по тегам
    function filterAddonsByTags(list: AddonInterface[], tags: Set<string>) {
        if (tags.size === 0) return list
        return list.filter((item) => item.tags?.some((t) => tags.has(t)))
    }

    // Сколько полей отсутствует
    function getMissingCount(addon: AddonInterface): number {
        return checkMissingFields(addon).length
    }

    // Приоритет
    // 0 = включённая тема
    // 1 = включённый скрипт
    // 2 = остальное
    // 999 = есть ошибки (не все поля заполнены)
    function getPriority(addon: AddonInterface): number {
        const missingCount = getMissingCount(addon)
        if (missingCount > 0) {
            return 999
        }
        const isTheme = addon.type === 'theme'
        const isEnabledTheme = isTheme && addon.directoryName === currentTheme
        if (isEnabledTheme) return 0
        const isScript = addon.type === 'script'
        const isEnabledScript = isScript && enabledScripts.includes(addon.directoryName)
        if (isEnabledScript) return 1
        return 2
    }

    // Собираем финальный список
    function getMergedSortedAddons(): AddonInterface[] {
        let filtered = filterAddonsByTags(addons, selectedTags)
        filtered = filterAndSortAddons(filtered)

        if (hideEnabled) {
            filtered = filtered.filter((item) => {
                if (item.type === 'theme') {
                    return item.directoryName !== currentTheme
                }
                return !enabledScripts.includes(item.directoryName)
            })
        }

        // Сортируем
        filtered.sort((a, b) => {
            // Приоритет
            const priA = getPriority(a)
            const priB = getPriority(b)
            if (priA !== priB) {
                return priA - priB
            }
            // Доп. критерий: matches
            const aMatch = a.matches ? 1 : 0
            const bMatch = b.matches ? 1 : 0
            return bMatch - aMatch
        })

        return filtered
    }

    const mergedAddons = getMergedSortedAddons()

    useEffect(() => {
        // Запоминаем самое большое кол-во, чтобы в UI отобразить «Найдено: ...»
        setMaxAddonCount((prev) => Math.max(prev, mergedAddons.length))
    }, [mergedAddons])

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
            setFilterVisible((prev) => {
                if (!prev) setOptionMenu(false)
                return !prev
            })
        } else {
            setOptionMenu((prev) => {
                if (!prev) setFilterVisible(false)
                return !prev
            })
        }
    }

    // Закрываем выпадашки при клике вне
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
                        {/* Тулбар с поиском, кнопками */}
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
                                            <div className={extensionStyles.searchLabel}>
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
                                            {Array.from(
                                                new Set(
                                                    addons.flatMap(
                                                        (item) => item.tags || [],
                                                    ),
                                                ),
                                            ).map((tag) => (
                                                <CustomCheckbox
                                                    key={tag}
                                                    checked={selectedTags.has(tag)}
                                                    onChange={() =>
                                                        handleTagChange(tag)
                                                    }
                                                    label={tag}
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

                        {/* Сетка с аддонами */}
                        <div className={globalStyles.container30x15}>
                            <div className={extensionStyles.preview}>
                                <div className={extensionStyles.previewSelection}>
                                    <div
                                        className={extensionStyles.grid}
                                        style={{
                                            gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                                        }}
                                    >
                                        {mergedAddons.map((addon) => {
                                            const checked =
                                                addon.type === 'theme'
                                                    ? addon.directoryName === currentTheme
                                                    : enabledScripts.includes(
                                                          addon.directoryName,
                                                      )

                                            return (
                                                <ExtensionCard
                                                    key={addon.name}
                                                    theme={addon}
                                                    isChecked={checked}
                                                    onCheckboxChange={(
                                                        _unused,
                                                        newIsChecked,
                                                    ) =>
                                                        handleCheckboxChange(
                                                            addon,
                                                            newIsChecked,
                                                        )
                                                    }
                                                    className={
                                                        addon.matches
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
