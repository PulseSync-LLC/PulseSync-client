// extensionbeta/index.tsx

import Layout from '../../components/layout';
import Container from '../../components/container';
import * as styles from '../../../../static/styles/page/index.module.scss';
import * as theme from './extension.module.scss';
import ExtensionCard from '../../components/extensionCard';
import React, { useContext, useEffect, useState } from 'react'
import ThemeInterface from '../../api/interfaces/theme.interface';
import Button from '../../components/button';
import stringSimilarity from 'string-similarity';
import CustomCheckbox from '../../components/checkbox_props';
import { useLocation, useNavigate } from 'react-router-dom'
import toast from '../../api/toast'
import userContext from '../../api/context/user.context'

import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'
import FilterImg from './../../../../static/assets/stratis-icons/filter.svg'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'

export default function ExtensionPage() {
    const [selectedTheme, setSelectedTheme] = useState(
        window.electron.store.get('theme') || 'Default'
    );
    const { themes, setThemes } = useContext(userContext)
    const [maxThemesCount, setMaxThemesCount] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [hideEnabled, setHideEnabled] = useState(false);
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getThemes')
                .then((themes: ThemeInterface[]) => {
                    setThemes(themes)
                })
        }
    }, []);
    useEffect(() => {
        console.log(themes)
    }, [themes])
    const handleCheckboxChange = (themeName: string, isChecked: boolean) => {
        const newTheme = isChecked ? themeName : 'Default';
        window.electron.store.set('theme', newTheme);
        setSelectedTheme(newTheme);
        window.desktopEvents.send('themeChanged', newTheme);
    };

    const handleDeleteTheme = (themeName: string) => {
        const isConfirmed = window.confirm(`Вы уверены, что хотите удалить тему "${themeName}"? Это действие нельзя будет отменить.`);

        if (isConfirmed) {
            const themeToDelete = themes.find(theme => theme.name === themeName);

            if (themeToDelete && themeToDelete.path) {
                const themeDirectoryPath = themeToDelete.path;

                window.desktopEvents
                    .invoke('deleteThemeDirectory', themeDirectoryPath)
                    .then(() => {
                        setThemes((prevThemes: any[]) =>
                            prevThemes.filter(
                                theme => theme.name !== themeName,
                            ),
                        )
                        console.log(`Тема "${themeName}" и связанные файлы удалены.`);
                    })
                    .catch(error => {
                        console.error(`Ошибка при удалении темы "${themeName}":`, error);
                    });
            } else {
                console.error(`Тема "${themeName}" не найдена для удаления.`);
            }
        }
    };

    const handleExportTheme = (themeName: string) => {
        const theme = themes.find(theme => theme.name === themeName);
        window.desktopEvents.invoke("exportTheme", {
            path: theme.path,
            name: theme.name
        }).then((result) => {
            if (result) {
                toast.success("Успешный экспорт")
            }
        }).catch(error => {
            console.error(error);
        })
    }

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(event.target.value.toLowerCase());
    };

    const handleHideEnabledChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setHideEnabled(event.target.checked);
    };

    const handleTagChange = (tag: string) => {
        const updatedTags = new Set(selectedTags);
        if (updatedTags.has(tag)) {
            updatedTags.delete(tag);
        } else {
            updatedTags.add(tag);
        }
        setSelectedTags(updatedTags);
    };

    const filterAndSortThemes = (themes: ThemeInterface[]) => {
        return themes
            .filter(theme => theme.name !== 'Default')
            .map(theme => ({
                ...theme,
                matches: theme.name.toLowerCase().includes(searchQuery) ||
                    theme.author.toLowerCase().includes(searchQuery) ||
                    stringSimilarity.compareTwoStrings(theme.name.toLowerCase(), searchQuery) > 0.35 ||
                    stringSimilarity.compareTwoStrings(theme.author.toLowerCase(), searchQuery) > 0.35,
            }))
            .sort((a, b) => a.matches === b.matches ? 0 : a.matches ? -1 : 1);
    };

    const filterThemesByTags = (themes: ThemeInterface[], tags: Set<string>) => {
        if (tags.size === 0) return themes;
        return themes.filter(theme => theme.tags?.some(tag => tags.has(tag)));
    };

    const getFilteredThemes = (themeType: string) => {
        const filteredThemes = filterAndSortThemes(filterThemesByTags(themes, selectedTags));
        return themeType === selectedTheme ? filteredThemes.filter(theme => theme.name === selectedTheme) : filteredThemes.filter(theme => theme.name !== selectedTheme);
    };

    const enabledThemes = getFilteredThemes(selectedTheme);
    const disabledThemes = getFilteredThemes('other');

    const filteredEnabledThemes = hideEnabled ? [] : enabledThemes;
    const filteredDisabledThemes = hideEnabled ? disabledThemes : disabledThemes;

    const allTags = Array.from(new Set(themes.flatMap(theme => theme.tags || [])));

    const tagCounts = allTags.reduce((acc, tag) => {
        acc[tag] = themes.filter(theme => theme.tags?.includes(tag)).length;
        return acc;
    }, {} as Record<string, number>);

    const filterThemes = (themes: ThemeInterface[]) => {
        return themes
            .filter(theme => theme.name.toLowerCase() !== 'default' && (
                theme.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                theme.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
                stringSimilarity.compareTwoStrings(theme.name.toLowerCase(), searchQuery.toLowerCase()) > 0.35 ||
                stringSimilarity.compareTwoStrings(theme.author.toLowerCase(), searchQuery.toLowerCase()) > 0.35
            ))
            .sort((a, b) => (a.name < b.name ? -1 : 1));
    };

    const filteredThemes = filterThemes(themes);

    useEffect(() => {
        setMaxThemesCount(prevCount => Math.max(prevCount, filteredThemes.length));
    }, [filteredThemes]);

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
                                    {filteredThemes.length > 0 && filteredThemes.length < maxThemesCount && (
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
                                <button className={theme.toolbarButton} onClick={() => window.desktopEvents.send('openPath', 'themePath')}><FileImg /></button>
                                <button disabled className={theme.toolbarButton}><ArrowRefreshImg /></button>
                                <button disabled className={theme.toolbarButton}><FilterImg /></button>
                            </div>
                        </div>
                        <div className={styles.container30x15}>
                            {/* <div className={theme.containerSearch}>
                                <div className={theme.searchSection}>
                                    <div className={theme.searchLabel}>
                                        Поиск ({totalVisibleThemesCount})
                                    </div>
                                    <input
                                        className={theme.searchInput}
                                        type="text"
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        placeholder="Введите название расширения"
                                    />
                                </div>
                                <div className={theme.tagsSection}>
                                    <div className={theme.tagsLabel}>Tags</div>
                                    {allTags.map((tag) => (
                                        <CustomCheckbox
                                            key={tag}
                                            checked={selectedTags.has(tag)}
                                            onChange={() => handleTagChange(tag)}
                                            label={`${tag} (${tagCounts[tag]})`}
                                            className={selectedTags.has(tag) ? theme.selectedTag : ''}
                                        />
                                    ))}
                                    <CustomCheckbox
                                        checked={hideEnabled}
                                        onChange={handleHideEnabledChange}
                                        label="Скрыть включенные"
                                    />
                                </div>
                            </div> */}
                            <div className={theme.preview}>
                                {filteredEnabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div className={theme.selectionContainerLable}>
                                            <div className={theme.labelSelection}>Enable</div>
                                            <div className={theme.line}></div>
                                        </div>
                                        <div className={theme.grid}>
                                            {filteredEnabledThemes.map((theme) => (
                                                <ExtensionCard
                                                    key={theme.name}
                                                    theme={theme}
                                                    isChecked={true}
                                                    onCheckboxChange={handleCheckboxChange}
                                                    onDelete={handleDeleteTheme}
                                                    exportTheme={(themeName) => handleExportTheme(themeName)}
                                                    className={theme.matches ? 'highlight' : 'dimmed'}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {filteredDisabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div className={theme.selectionContainerLable}>
                                            <div className={theme.labelSelection}>Disable</div>
                                            <div className={theme.line}></div>
                                        </div>
                                        <div className={theme.grid}>
                                            {filteredDisabledThemes.map((theme) => (
                                                <ExtensionCard
                                                    key={theme.name}
                                                    theme={theme}
                                                    isChecked={false}
                                                    onCheckboxChange={handleCheckboxChange}
                                                    onDelete={handleDeleteTheme}
                                                    exportTheme={(themeName) => handleExportTheme(themeName)}
                                                    className={theme.matches ? 'highlight' : 'dimmed'}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
