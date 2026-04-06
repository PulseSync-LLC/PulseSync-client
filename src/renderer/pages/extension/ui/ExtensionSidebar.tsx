import React from 'react'
import cn from 'clsx'
import { MdFilterList, MdMoreHoriz } from 'react-icons/md'

import Addon from '@entities/addon/model/addon.interface'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import AddonFilters from '@shared/ui/PSUI/AddonFilters'
import OptionMenu from '@shared/ui/PSUI/OptionMenu'
import AddonCard from '@pages/extension/ui/AddonCard'
import * as extensionStylesV2 from '@pages/extension/extension.module.scss'
import type { SortKey } from '@pages/extension/model/addonCatalog'

type Props = {
    containerRef: React.RefObject<HTMLDivElement | null>
    currentTheme: string
    disabledAddons: Addon[]
    enabledAddons: Addon[]
    enabledScripts: string[]
    fallbackAddonImage: string
    filterButtonRef: React.RefObject<HTMLButtonElement | null>
    getImagePath: (addon: Addon) => string
    onAddonClick: (addon: Addon) => void
    onDisableAddon: (addon: Addon) => void
    onEnableAddon: (addon: Addon) => void
    onCreateNewAddon: () => void
    onOpenAddonsDirectory: () => void
    onReloadAddons: () => void
    onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    onSortChange: (option: SortKey) => void
    onToggleCreator: (creator: string) => void
    onToggleFilters: () => void
    onToggleOptionMenu: () => void
    onToggleTag: (tag: string) => void
    optionButtonRef: React.RefObject<HTMLButtonElement | null>
    optionMenu: boolean
    searchQuery: string
    selectedAddon: Addon | null
    selectedCreators: Set<string>
    selectedTags: Set<string>
    setSelectedCreators: React.Dispatch<React.SetStateAction<Set<string>>>
    setSelectedTags: React.Dispatch<React.SetStateAction<Set<string>>>
    setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>
    setType: React.Dispatch<React.SetStateAction<'all' | 'theme' | 'script'>>
    showFilters: boolean
    sort: SortKey
    sortOrder: 'asc' | 'desc'
    t: (key: string, options?: Record<string, any>) => string
    type: 'all' | 'theme' | 'script'
    uniqueCreators: string[]
    uniqueTags: string[]
}

function getActiveFiltersCount(type: 'all' | 'theme' | 'script', sort: SortKey, selectedTags: Set<string>, selectedCreators: Set<string>) {
    return (type !== 'all' ? 1 : 0) + (sort !== 'type' ? 1 : 0) + selectedTags.size + selectedCreators.size
}

export default function ExtensionSidebar({
    containerRef,
    currentTheme,
    disabledAddons,
    enabledAddons,
    enabledScripts,
    fallbackAddonImage,
    filterButtonRef,
    getImagePath,
    onAddonClick,
    onCreateNewAddon,
    onDisableAddon,
    onEnableAddon,
    onOpenAddonsDirectory,
    onReloadAddons,
    onSearchChange,
    onSortChange,
    onToggleCreator,
    onToggleFilters,
    onToggleOptionMenu,
    onToggleTag,
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

    return (
        <>
            <div ref={containerRef}>
                {showFilters && (
                    <AddonFilters
                        tags={uniqueTags}
                        creators={uniqueCreators}
                        sort={sort}
                        sortOrder={sortOrder}
                        type={type}
                        selectedTags={selectedTags}
                        selectedCreators={selectedCreators}
                        onSortChange={onSortChange}
                        onTypeChange={setType}
                        onToggleTag={onToggleTag}
                        onToggleCreator={onToggleCreator}
                        setType={setType}
                        setSelectedTags={setSelectedTags}
                        setSelectedCreators={setSelectedCreators}
                        onSortOrderChange={setSortOrder}
                    />
                )}
                {optionMenu && (
                    <OptionMenu onReloadAddons={onReloadAddons} onOpenAddonsDirectory={onOpenAddonsDirectory} onCreateNewAddon={onCreateNewAddon} />
                )}
            </div>
            <Scrollbar className={extensionStylesV2.leftSide} classNameInner={extensionStylesV2.leftSideInner}>
                <div className={extensionStylesV2.topContainer}>
                    <div className={extensionStylesV2.searchContainer}>
                        <input
                            type="text"
                            placeholder={t('extensions.searchPlaceholder')}
                            value={searchQuery}
                            onChange={onSearchChange}
                            className={extensionStylesV2.searchInput}
                        />
                        <button
                            ref={filterButtonRef}
                            className={extensionStylesV2.filterButton}
                            style={showFilters ? { background: '#98FFD6', color: '#181818' } : undefined}
                            onClick={onToggleFilters}
                            aria-label={t('extensions.filtersLabel')}
                        >
                            <MdFilterList />
                            {activeFiltersCount > 0 ? (
                                <div className={extensionStylesV2.count}>{activeFiltersCount > 9 ? '9+' : activeFiltersCount}</div>
                            ) : null}
                        </button>
                    </div>
                    <button
                        ref={optionButtonRef}
                        className={cn(extensionStylesV2.optionsButton, optionMenu && extensionStylesV2.optionsButtonActive)}
                        style={optionMenu ? { background: '#98FFD6', color: '#181818' } : undefined}
                        onClick={onToggleOptionMenu}
                        aria-label={t('extensions.optionsLabel')}
                    >
                        <MdMoreHoriz />
                    </button>
                </div>
                <div className={extensionStylesV2.addonList}>
                    <div className={extensionStylesV2.enabledAddons}>
                        {enabledAddons.map(addon => (
                            <AddonCard
                                key={addon.directoryName}
                                addon={addon}
                                currentTheme={currentTheme}
                                enabledScripts={enabledScripts}
                                fallbackAddonImage={fallbackAddonImage}
                                getImagePath={getImagePath}
                                isActive={selectedAddon?.directoryName === addon.directoryName}
                                onClick={onAddonClick}
                                onDisable={onDisableAddon}
                                onEnable={onEnableAddon}
                            />
                        ))}
                    </div>
                    {enabledAddons.length > 0 && disabledAddons.length > 0 && <div className={extensionStylesV2.line}></div>}
                    {enabledAddons.length === 0 && disabledAddons.length === 0 && (
                        <div className={extensionStylesV2.noFix}>
                            <div className={extensionStylesV2.noResults}>{t('extensions.noResults')}</div>
                        </div>
                    )}
                    <div className={extensionStylesV2.disabledAddons}>
                        {disabledAddons.map(addon => (
                            <AddonCard
                                key={addon.directoryName}
                                addon={addon}
                                currentTheme={currentTheme}
                                enabledScripts={enabledScripts}
                                fallbackAddonImage={fallbackAddonImage}
                                getImagePath={getImagePath}
                                isActive={selectedAddon?.directoryName === addon.directoryName}
                                onClick={onAddonClick}
                                onDisable={onDisableAddon}
                                onEnable={onEnableAddon}
                            />
                        ))}
                    </div>
                </div>
            </Scrollbar>
        </>
    )
}
