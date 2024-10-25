// extensionbeta/index.tsx

import Layout from '../../components/layout';
import Container from '../../components/container';
import * as styles from '../../../../static/styles/page/index.module.scss';
import * as theme from './extension.module.scss';
import ExtensionCard from '../../components/extensionCard';
import { useEffect, useState } from 'react';
import ThemeInterface from '../../api/interfaces/theme.interface';
import Button from '../../components/button';
import stringSimilarity from 'string-similarity';
import CustomCheckbox from '../../components/checkbox_props';
import { useLocation } from 'react-router-dom';

export default function ExtensionPage() {
    const [themes, setThemes] = useState<ThemeInterface[]>([]);
    const [selectedTheme, setSelectedTheme] = useState(
        window.electron.store.get('theme') || 'Default'
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [hideEnabled, setHideEnabled] = useState(false);
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

    const location = useLocation();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const selectedTagFromUrl = params.get('selectedTag');
        if (selectedTagFromUrl) {
            setSelectedTags(new Set([selectedTagFromUrl]));
        }
    }, [location.search]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getThemes')
                .then((themes: ThemeInterface[]) => setThemes(themes))
                .catch((error) => console.error('Error receiving themes:', error));
        }
    }, []);

    const handleCheckboxChange = (themeName: string, isChecked: boolean) => {
        const newTheme = isChecked ? themeName : 'Default';
        window.electron.store.set('theme', newTheme);
        setSelectedTheme(newTheme);
        window.desktopEvents.send('themeChanged', newTheme);
    };

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

    const totalVisibleThemesCount = filteredEnabledThemes.length + filteredDisabledThemes.length;

    return (
        <Layout title="Стилизация">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <Container
                            titleName={'Ваши расширения (BETA)'}
                            description={'Вы можете управлять всеми установленными расширениями для PulseSync.'}
                            imageName={'extension'}
                        >
                            <Button
                                title=""
                                onClick={() => window.desktopEvents.send('openPath', 'themePath')}
                                children={'Директория аддонов'}
                            />
                        </Container>
                        <div className={styles.container30x15}>
                            <div className={theme.containerSearch}>
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
                            </div>
                            <div className={theme.preview}>
                                {filteredEnabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div className={theme.labelSelection}>Enable</div>
                                        <div className={theme.grid}>
                                            {filteredEnabledThemes.map((theme) => (
                                                <ExtensionCard
                                                    key={theme.name}
                                                    theme={theme}
                                                    isChecked={true}
                                                    onCheckboxChange={handleCheckboxChange}
                                                    className={theme.matches ? 'highlight' : 'dimmed'}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {filteredDisabledThemes.length > 0 && (
                                    <div className={theme.previewSelection}>
                                        <div className={theme.labelSelection}>Disable</div>
                                        <div className={theme.grid}>
                                            {filteredDisabledThemes.map((theme) => (
                                                <ExtensionCard
                                                    key={theme.name}
                                                    theme={theme}
                                                    isChecked={false}
                                                    onCheckboxChange={handleCheckboxChange}
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
