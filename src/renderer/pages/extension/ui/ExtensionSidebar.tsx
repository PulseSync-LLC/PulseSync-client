import React from 'react'
import cn from 'clsx'
import { MdChevronRight, MdFilterList, MdFolder, MdMoreHoriz } from 'react-icons/md'
import { Accordion, type AccordionItem } from '@pulsesync/uikit/layout'

import type { DesktopAddonOrganization } from '@common/desktopApi/contract'
import Addon from '@entities/addon/model/addon.interface'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import AddonFilters from '@shared/ui/PSUI/AddonFilters'
import OptionMenu from '@shared/ui/PSUI/OptionMenu'
import CustomFormikModalPS from '@shared/ui/PSUI/CustomFormikModalPS'
import AddonCard from '@pages/extension/ui/AddonCard'
import * as extensionStylesV2 from '@pages/extension/extension.module.scss'
import type { AddonTypeFilter, SortKey } from '@pages/extension/model/addonCatalog'
import { staticAsset } from '@shared/lib/staticAssets'
import toast from '@shared/ui/toast'

const ADDON_DRAG_TYPE = 'application/x-pulsesync-addon-id'
const DRAG_OPEN_DELAY_MS = 550

type Props = {
    addonOrganization: DesktopAddonOrganization
    addonImagesReady: boolean
    addons: Addon[]
    containerRef: React.RefObject<HTMLDivElement | null>
    currentTheme: string
    enabledScripts: string[]
    fallbackAddonImage: string
    filterButtonRef: React.RefObject<HTMLButtonElement | null>
    getImagePath: (addon: Addon) => string
    onAddonClick: (addon: Addon) => void
    onAssignAddonCategory: (addon: Addon, categoryId: string | null) => void
    onCreateCategory: (name: string) => boolean
    onCreateNewAddon: () => void
    onDeleteCategory: (categoryId: string, categoryName: string) => void
    onDisableAddon: (addon: Addon) => void
    onEnableAddon: (addon: Addon) => void
    onFiltersOpenChange: (open: boolean) => void
    onOpenAddonsDirectory: () => void
    onOptionMenuOpenChange: (open: boolean) => void
    onReloadAddons: () => void
    onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    onMoveAddon: (addon: Addon, categoryId: string | null, favorite: boolean) => void
    onSetAddonFavorite: (addon: Addon, favorite: boolean) => void
    onSortChange: (option: SortKey) => void
    optionButtonRef: React.RefObject<HTMLButtonElement | null>
    optionMenu: boolean
    searchQuery: string
    selectedAddon: Addon | null
    selectedCreators: Set<string>
    selectedTags: Set<string>
    setSelectedCreators: React.Dispatch<React.SetStateAction<Set<string>>>
    setSelectedTags: React.Dispatch<React.SetStateAction<Set<string>>>
    setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>
    setType: React.Dispatch<React.SetStateAction<AddonTypeFilter>>
    showFilters: boolean
    sort: SortKey
    sortOrder: 'asc' | 'desc'
    t: (key: string, options?: Record<string, any>) => string
    type: AddonTypeFilter
    uniqueCreators: string[]
    uniqueTags: string[]
}

function getActiveFiltersCount(type: AddonTypeFilter, sort: SortKey, selectedTags: Set<string>, selectedCreators: Set<string>) {
    return (type !== 'all' ? 1 : 0) + (sort !== 'type' ? 1 : 0) + selectedTags.size + selectedCreators.size
}

export default function ExtensionSidebar({
    addonOrganization,
    addonImagesReady,
    addons,
    containerRef,
    currentTheme,
    enabledScripts,
    fallbackAddonImage,
    filterButtonRef,
    getImagePath,
    onAddonClick,
    onAssignAddonCategory,
    onCreateCategory,
    onCreateNewAddon,
    onDeleteCategory,
    onDisableAddon,
    onEnableAddon,
    onFiltersOpenChange,
    onOpenAddonsDirectory,
    onOptionMenuOpenChange,
    onReloadAddons,
    onSearchChange,
    onMoveAddon,
    onSetAddonFavorite,
    onSortChange,
    optionButtonRef,
    optionMenu,
    searchQuery,
    selectedAddon,
    selectedCreators,
    selectedTags,
    setSelectedCreators,
    setSelectedTags,
    setSortOrder,
    setType,
    showFilters,
    sort,
    sortOrder,
    t,
    type,
    uniqueCreators,
    uniqueTags,
}: Props) {
    const activeFiltersCount = getActiveFiltersCount(type, sort, selectedTags, selectedCreators)
    const [openGroups, setOpenGroups] = React.useState<string[]>(['favorites', 'uncategorized'])
    const [createCategoryOpen, setCreateCategoryOpen] = React.useState(false)
    const [draggingAddonId, setDraggingAddonId] = React.useState<string | null>(null)
    const [dropTargetKey, setDropTargetKey] = React.useState<string | null>(null)
    const knownCategoryIdsRef = React.useRef<Set<string>>(new Set())
    const dragOpenTimerRef = React.useRef<number | null>(null)
    const pendingOpenKeyRef = React.useRef<string | null>(null)

    const clearDragOpenTimer = React.useCallback(() => {
        if (dragOpenTimerRef.current !== null) window.clearTimeout(dragOpenTimerRef.current)
        dragOpenTimerRef.current = null
        pendingOpenKeyRef.current = null
    }, [])

    React.useEffect(() => clearDragOpenTimer, [clearDragOpenTimer])

    React.useEffect(() => {
        const categoryIds = new Set(addonOrganization.categories.map(category => category.id))
        const addedKeys = addonOrganization.categories
            .filter(category => !knownCategoryIdsRef.current.has(category.id))
            .map(category => `category:${category.id}`)

        setOpenGroups(current => {
            const retained = current.filter(key => !key.startsWith('category:') || categoryIds.has(key.slice('category:'.length)))
            return Array.from(new Set([...retained, ...addedKeys]))
        })
        knownCategoryIdsRef.current = categoryIds
    }, [addonOrganization.categories])

    const favoriteIds = React.useMemo(() => new Set(addonOrganization.favoriteAddonIds), [addonOrganization.favoriteAddonIds])
    const favoriteAddons = addons.filter(addon => favoriteIds.has(addon.id))
    const uncategorizedAddons = addons.filter(addon => !addonOrganization.categoryByAddonId[addon.id])

    const scheduleGroupOpen = (key: string) => {
        if (openGroups.includes(key) || pendingOpenKeyRef.current === key) return
        clearDragOpenTimer()
        pendingOpenKeyRef.current = key
        dragOpenTimerRef.current = window.setTimeout(() => {
            setOpenGroups(current => (current.includes(key) ? current : [...current, key]))
            dragOpenTimerRef.current = null
            pendingOpenKeyRef.current = null
        }, DRAG_OPEN_DELAY_MS)
    }

    const finishDrag = () => {
        clearDragOpenTimer()
        setDraggingAddonId(null)
        setDropTargetKey(null)
    }

    const showDropToast = (addon: Addon, message: string) =>
        toast.custom('success', t('common.doneTitle'), message, { id: `addon-organization-drop:${addon.id}` })

    const getDraggedAddon = (event: React.DragEvent) => {
        const addonId = event.dataTransfer.getData(ADDON_DRAG_TYPE) || event.dataTransfer.getData('text/plain') || draggingAddonId
        return addons.find(addon => addon.id === addonId) ?? null
    }

    const handleDrop = (key: string, event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const addon = getDraggedAddon(event)
        finishDrag()
        if (!addon) return

        if (key === 'favorites') {
            if (favoriteIds.has(addon.id)) return
            const previousCategoryId = addonOrganization.categoryByAddonId[addon.id] ?? null
            onMoveAddon(addon, previousCategoryId, true)
            showDropToast(addon, t('extensions.organization.addedToFavorites', { name: addon.name }))
            return
        }

        const previousCategoryId = addonOrganization.categoryByAddonId[addon.id] ?? null
        const wasFavorite = favoriteIds.has(addon.id)
        const categoryId = key === 'uncategorized' ? null : key.slice('category:'.length)
        if (previousCategoryId === categoryId && !wasFavorite) return
        const categoryLabel =
            categoryId === null
                ? t('extensions.organization.uncategorized')
                : (addonOrganization.categories.find(category => category.id === categoryId)?.name ?? t('extensions.organization.uncategorized'))

        onMoveAddon(addon, categoryId, false)
        showDropToast(addon, t('extensions.organization.movedToCategory', { name: addon.name, category: categoryLabel }))
    }

    const getDropHandlers = (key: string) => ({
        onDragEnter: (event: React.DragEvent) => {
            event.preventDefault()
            setDropTargetKey(key)
            scheduleGroupOpen(key)
        },
        onDragOver: (event: React.DragEvent) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = key === 'favorites' ? 'copy' : 'move'
            if (dropTargetKey !== key) setDropTargetKey(key)
            scheduleGroupOpen(key)
        },
        onDragLeave: (event: React.DragEvent) => {
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
            if (dropTargetKey === key) setDropTargetKey(null)
            if (pendingOpenKeyRef.current === key) clearDragOpenTimer()
        },
        onDrop: (event: React.DragEvent) => handleDrop(key, event),
    })

    const createGroupTitle = (key: string, label: string, count: number, favorite = false) => {
        const isOpen = openGroups.includes(key)

        return (
            <span
                className={cn(extensionStylesV2.addonGroupTitle, dropTargetKey === key && extensionStylesV2.addonGroupDropTarget)}
                {...getDropHandlers(key)}
            >
                {isOpen ? (
                    <img className={extensionStylesV2.addonGroupToggleIcon} src={staticAsset('assets/icons/ui/addon-group-category.svg')} alt="" />
                ) : (
                    <MdChevronRight className={extensionStylesV2.addonGroupToggleIcon} aria-hidden />
                )}
                <span className={extensionStylesV2.addonGroupLabel}>{label}</span>
                <span className={extensionStylesV2.addonGroupCount}>({count})</span>
                {favorite ? (
                    <img className={extensionStylesV2.addonGroupSemanticIcon} src={staticAsset('assets/icons/ui/addon-group-favorites.svg')} alt="" />
                ) : (
                    <MdFolder className={extensionStylesV2.addonGroupSemanticIcon} aria-hidden />
                )}
            </span>
        )
    }

    const renderAddonCard = (addon: Addon) => (
        <AddonCard
            key={addon.id}
            addon={addon}
            categories={addonOrganization.categories}
            categoryId={addonOrganization.categoryByAddonId[addon.id] ?? null}
            currentTheme={currentTheme}
            enabledScripts={enabledScripts}
            fallbackAddonImage={fallbackAddonImage}
            getImagePath={getImagePath}
            imageReady={addonImagesReady}
            isActive={selectedAddon?.directoryName === addon.directoryName}
            isDragging={draggingAddonId === addon.id}
            isFavorite={favoriteIds.has(addon.id)}
            onAssignCategory={onAssignAddonCategory}
            onClick={onAddonClick}
            onDisable={onDisableAddon}
            onDragEnd={finishDrag}
            onDragStart={(draggedAddon, event) => {
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(ADDON_DRAG_TYPE, draggedAddon.id)
                event.dataTransfer.setData('text/plain', draggedAddon.id)
                setDraggingAddonId(draggedAddon.id)
            }}
            onEnable={onEnableAddon}
            onSetFavorite={onSetAddonFavorite}
        />
    )

    const createGroup = (key: string, label: string, groupAddons: Addon[], favorite = false): AccordionItem => {
        const isOpen = openGroups.includes(key)
        return {
            key,
            title: createGroupTitle(key, label, groupAddons.length, favorite),
            content: (
                <div className={extensionStylesV2.addonGroupCards} aria-hidden={!isOpen} inert={!isOpen} {...getDropHandlers(key)}>
                    {groupAddons.map(renderAddonCard)}
                </div>
            ),
        }
    }

    const groupItems: AccordionItem[] = [
        createGroup('favorites', t('extensions.groups.favorites'), favoriteAddons, true),
        ...addonOrganization.categories.map(category =>
            createGroup(
                `category:${category.id}`,
                category.name,
                addons.filter(addon => addonOrganization.categoryByAddonId[addon.id] === category.id),
            ),
        ),
        createGroup('uncategorized', t('extensions.organization.uncategorized'), uncategorizedAddons),
    ]

    const submitCategory = (values: { input: string }) => {
        if (onCreateCategory(values.input)) {
            setCreateCategoryOpen(false)
        }
    }

    return (
        <>
            <CustomFormikModalPS
                isOpen={createCategoryOpen}
                onClose={() => setCreateCategoryOpen(false)}
                title={t('extensions.organization.createCategory')}
                text={t('extensions.organization.categoryNameLabel')}
                inputPlaceholder={t('extensions.organization.categoryNamePlaceholder')}
                onSubmit={submitCategory}
                buttons={[
                    {
                        text: t('modals.basicConfirmation.cancel'),
                        onClick: () => setCreateCategoryOpen(false),
                        variant: 'secondary',
                    },
                    {
                        text: t('extensions.organization.createAction'),
                        onClick: values => submitCategory(values ?? { input: '' }),
                    },
                ]}
            />
            <Scrollbar className={extensionStylesV2.leftSide} classNameInner={extensionStylesV2.leftSideInner}>
                <div ref={containerRef} className={extensionStylesV2.topContainer}>
                    <div className={extensionStylesV2.searchContainer}>
                        <img className={extensionStylesV2.searchIcon} src={staticAsset('assets/icons/ui/package-search.svg')} alt="" />
                        <input
                            type="text"
                            placeholder={t('extensions.searchPlaceholder')}
                            value={searchQuery}
                            onChange={onSearchChange}
                            className={extensionStylesV2.searchInput}
                        />
                        <AddonFilters
                            tags={uniqueTags}
                            creators={uniqueCreators}
                            sort={sort}
                            sortOrder={sortOrder}
                            type={type}
                            selectedTags={selectedTags}
                            selectedCreators={selectedCreators}
                            onSortChange={onSortChange}
                            setType={setType}
                            setSelectedTags={setSelectedTags}
                            setSelectedCreators={setSelectedCreators}
                            onSortOrderChange={setSortOrder}
                            onOpenChange={onFiltersOpenChange}
                        >
                            <button
                                ref={filterButtonRef}
                                className={extensionStylesV2.filterButton}
                                style={showFilters ? { background: 'var(--accent)', color: 'var(--accent-foreground)' } : undefined}
                                aria-label={t('extensions.filtersLabel')}
                            >
                                <MdFilterList />
                                {activeFiltersCount > 0 ? (
                                    <div className={extensionStylesV2.count}>{activeFiltersCount > 9 ? '9+' : activeFiltersCount}</div>
                                ) : null}
                            </button>
                        </AddonFilters>
                    </div>
                    <OptionMenu
                        onReloadAddons={onReloadAddons}
                        onOpenAddonsDirectory={onOpenAddonsDirectory}
                        onCreateNewAddon={onCreateNewAddon}
                        onCreateCategory={() => setCreateCategoryOpen(true)}
                        onDeleteCategory={onDeleteCategory}
                        categories={addonOrganization.categories}
                        onOpenChange={onOptionMenuOpenChange}
                    >
                        <button
                            ref={optionButtonRef}
                            className={cn(extensionStylesV2.optionsButton, optionMenu && extensionStylesV2.optionsButtonActive)}
                            aria-label={t('extensions.optionsLabel')}
                        >
                            <MdMoreHoriz />
                        </button>
                    </OptionMenu>
                </div>
                <div className={extensionStylesV2.addonList}>
                    <Accordion
                        items={groupItems}
                        multiple
                        numbered={false}
                        openKeys={openGroups}
                        onOpenKeysChange={setOpenGroups}
                        className={extensionStylesV2.addonGroups}
                        sectionClassName={extensionStylesV2.addonGroupSection}
                        headerClassName={extensionStylesV2.addonGroupHeader}
                        bodyClassName={extensionStylesV2.addonGroupBody}
                        showDivider={false}
                    />
                    {addons.length === 0 ? (
                        <div className={extensionStylesV2.noFix}>
                            <div className={extensionStylesV2.noResults}>{t('extensions.noResults')}</div>
                        </div>
                    ) : null}
                </div>
            </Scrollbar>
        </>
    )
}
