// extensionbeta/route/extensionview.tsx

import path from 'path';
import React, { useEffect, useState } from 'react';
import Layout from '../../../components/layout';
import * as styles from '../../../../../static/styles/page/index.module.scss';
import * as ex from './extensionview.module.scss';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import ThemeInterface from '../../../api/interfaces/theme.interface';
import Button from '../../../components/button';
import { MdBookmarkBorder, MdDesignServices, MdEdit, MdExplore, MdFolder, MdKeyboardArrowDown, MdMoreHoriz, MdSettings, MdStickyNote2, MdStoreMallDirectory } from 'react-icons/md';

interface ThemeConfig {
    sections: Section[];
}

interface Section {
    title: string;
    items: Item[];
}

interface Item {
    id: string;
    name: string;
    description: string;
    type: string;
    bool?: boolean;
    input?: string;
    buttons?: { name: string; text: string }[];
}


const ExtensionViewPage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const theme = location.state?.theme as ThemeInterface;
    const [bannerSrc, setBannerSrc] = useState('static/assets/images/no_themeBackground.png');
    const [selectedTheme, setSelectedTheme] = useState(window.electron.store.get('theme') || 'Default');
    const [isThemeEnabled, setIsThemeEnabled] = useState(selectedTheme !== 'Default');
    const [isExpanded, setIsExpanded] = useState(false);
    const [height, setHeight] = useState(84);
    const [activeTab, setActiveTab] = useState('Overview');
    const [themeConfig, setThemeConfig] = useState<any | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        const themeStates = window.electron.store.get('themes.themeIsExpanded') || {};

        if (!themeStates.hasOwnProperty(theme.name)) {
            themeStates[theme.name] = false;
            window.electron.store.set('themes.themeIsExpanded', themeStates);
        }

        setIsExpanded(themeStates[theme.name]);
    }, [theme]);

    const toggleExpand = () => {
        const newState = !isExpanded;
        setIsExpanded(newState);

        const themeStates = window.electron.store.get('themeIsExpanded') || {};
        themeStates[theme.name] = newState;
        window.electron.store.set('themes.themeIsExpanded', themeStates);
    };

    const toggleTheme = () => {
        const newTheme = isThemeEnabled ? 'Default' : theme.name;
        window.electron.store.set('theme', newTheme);
        setSelectedTheme(newTheme);
        window.desktopEvents.send('themeChanged', newTheme);
        setIsThemeEnabled(!isThemeEnabled);
    };

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        const targetHeight = isExpanded ? 277 : 84;
        const step = isExpanded ? -1 : 1;

        const animateOpacity = () => {
            setHeight((prev) => {
                if ((step < 0 && prev <= targetHeight) || (step > 0 && prev >= targetHeight)) {
                    clearInterval(interval!);
                    return targetHeight;
                }
                return prev + step;
            });
        };

        interval = setInterval(animateOpacity, 5);

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isExpanded]);

    const handleEnableTheme = () => {
        const newTheme = theme.name;
        window.electron.store.set('theme', newTheme);
        setSelectedTheme(newTheme);
        window.desktopEvents.send('themeChanged', newTheme);
        setIsThemeEnabled(true);
    };

    useEffect(() => {
        const storedTheme = window.electron.store.get('theme');
        setSelectedTheme(storedTheme);
        setIsThemeEnabled(storedTheme !== 'Default');
    }, []);

    const formatPath = (path: string) => {
        return encodeURI(path.replace(/\\/g, '/'));
    };

    const handleTagChange = (tag: string) => {
        navigate(`/extensionbeta?selectedTag=${encodeURIComponent(tag)}`, {
            replace: false
        });
    };

    if (!theme) {
        navigate('/extensionbeta', {
            replace: false
        });
        return null;
    }

    useEffect(() => {
        if (theme.path && theme.banner) {
            const bannerPath = formatPath(`${theme.path}/${theme.banner}`);
            fetch(bannerPath)
                .then((res) => {
                    if (res.ok) {
                        setBannerSrc(bannerPath);
                    }
                })
                .catch(() => {
                    setBannerSrc('static/assets/images/no_themeBackground.png');
                });
        }
    }, [theme]);

    const createConfigFile = async () => {
        const configPath = path.join(theme.path, 'handleEvents.json');
        const fileExists = await window.desktopEvents.invoke('file-event', 'check-file-exists', configPath);

        if (fileExists) {
            const configContent = await window.desktopEvents.invoke('file-event', 'read-file', configPath);
            setThemeConfig(JSON.parse(configContent));
        } else {
            const defaultContent: ThemeConfig = { sections: [] };
            const result = await window.desktopEvents.invoke('file-event', 'create-config-file', configPath, defaultContent);

            if (result.success) {
                setThemeConfig(defaultContent);
            } else {
                console.error('Ошибка при создании файла конфигурации:', result.error);
            }
        }
    };

    const saveConfig = async (updatedConfig: ThemeConfig) => {
        const configPath = path.join(theme.path, 'handleEvents.json');
        try {
            await window.desktopEvents.invoke('file-event', 'write-file', configPath, updatedConfig);
            console.log('Конфигурация успешно сохранена!');
        } catch (error) {
            console.error('Ошибка при сохранении конфигурации:', error);
        }
    };

    const handleChange = (
        sectionIndex: number,
        itemIndex: number | null,
        key: 'name' | 'description' | 'input' | 'text' | 'title' | 'bool' | 'id',
        value: any
    ) => {
        const updatedConfig = structuredClone(themeConfig);

        if (itemIndex !== null) {
            const section = updatedConfig.sections[sectionIndex];
            const item = section.items[itemIndex];
            if (item) {
                item[key] = value;
            }
        } else {
            updatedConfig.sections[sectionIndex][key] = value;
        }

        setThemeConfig(updatedConfig);
        saveConfig(updatedConfig);
    };


    const handleButtonChange = (sectionIndex: string | number, itemIndex: string | number, buttonIndex: string | number, key: string | number, newValue: any) => {
        const updatedConfig = structuredClone(themeConfig);

        if (
            updatedConfig.sections[sectionIndex] &&
            updatedConfig.sections[sectionIndex].items[itemIndex] &&
            updatedConfig.sections[sectionIndex].items[itemIndex].buttons[buttonIndex]
        ) {
            updatedConfig.sections[sectionIndex].items[itemIndex].buttons[buttonIndex][key] = newValue;

            setThemeConfig(updatedConfig);
            saveConfig(updatedConfig);
        }
    };


    useEffect(() => {
        if (!themeConfig) {
            createConfigFile();
        }
    }, [themeConfig]);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'Overview':
                return (
                    <div className={ex.galleryContainer}>
                        <div className={ex.galleryBox}>
                            Галерея
                            <div className={ex.comingSoon}>Скоро</div>
                        </div>
                        <div className={ex.galleryBox}>
                            Описание
                            <div className={ex.descriptionText}>
                                {theme.description && <div>{theme.description}</div>}
                            </div>
                        </div>
                    </div>
                );
            case 'Settings':
                return (
                    <>
                        {!themeConfig ? (
                            <div className={ex.settingsContent}>
                                {themeConfig?.sections.map((section: Section, sectionIndex: number) => (
                                    <div key={sectionIndex} className={ex.section}>
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                className={ex.sectionTitleInput}
                                                value={section.title}
                                                onChange={(e) => handleChange(sectionIndex, null, 'title', e.target.value)}
                                            />
                                        ) : (
                                            <div className={ex.sectionTitle}>{section.title}</div>
                                        )}
                                        {section.items.map((item: Item, itemIndex: number) => (
                                            <div key={itemIndex} className={`${ex.item} ${ex[`item-${item.type}`]}`}>
                                                {isEditing ? (
                                                    <>
                                                        <input
                                                            type="text"
                                                            className={ex.itemNameInput}
                                                            value={item.id}
                                                            onChange={(e) => handleChange(sectionIndex, itemIndex, 'id', e.target.value)}
                                                        />
                                                        <input
                                                            type="text"
                                                            className={ex.itemNameInput}
                                                            value={item.name}
                                                            onChange={(e) => handleChange(sectionIndex, itemIndex, 'name', e.target.value)}
                                                        />
                                                        <input
                                                            type="text"
                                                            className={ex.itemDescriptionInput}
                                                            value={item.description}
                                                            onChange={(e) => handleChange(sectionIndex, itemIndex, 'description', e.target.value)}
                                                        />
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className={ex.itemName}>{item.name}</div>
                                                        <div className={ex.itemDescription}>{item.description}</div>
                                                    </>
                                                )}
                                                {item.type === 'button' && (
                                                    isEditing ? (
                                                        <button
                                                            disabled
                                                            className={`${ex.itemButton} ${item.bool ? ex.itemButtonActive : ''}`}
                                                        >
                                                            {item.bool ? 'Включено' : 'Отключено'}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className={`${ex.itemButton} ${item.bool ? ex.itemButtonActive : ''}`}
                                                            onClick={() => handleChange(sectionIndex, itemIndex, 'bool', !item.bool)}
                                                        >
                                                            {item.bool ? 'Включено' : 'Отключено'}
                                                        </button>
                                                    )
                                                )}
                                                {item.type === 'color' && (
                                                    isEditing ? (
                                                        <input
                                                            type="text"
                                                            className={ex.itemColorInputText}
                                                            value={item.input}
                                                            onChange={(e) => handleChange(sectionIndex, itemIndex, 'input', e.target.value)}
                                                            placeholder="#FFFFFF"
                                                        />
                                                    ) : (
                                                        <input
                                                            type="color"
                                                            className={ex.itemColorInput}
                                                            value={item.input}
                                                            onChange={(e) => handleChange(sectionIndex, itemIndex, 'input', e.target.value)}
                                                        />
                                                    )
                                                )}
                                                {item.type === 'text' && item.buttons && (
                                                    <div className={ex.itemButtons}>
                                                        {item.buttons.map((button: { name: string; text: string }, buttonIndex: number) => (
                                                            <div key={buttonIndex} className={ex.buttonContainer}>
                                                                {isEditing ? (
                                                                    <input
                                                                        type="text"
                                                                        className={ex.buttonNameInput}
                                                                        value={button.name}
                                                                        onChange={(e) => {
                                                                            const newName = e.target.value;
                                                                            handleButtonChange(sectionIndex, itemIndex, buttonIndex, 'name', newName); // Изменяем имя кнопки
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <div className={ex.buttonName}>{button.name}</div>
                                                                )}
                                                                {isEditing ? (
                                                                    <input
                                                                        type="text"
                                                                        className={ex.buttonTextInput}
                                                                        value={button.text}
                                                                        disabled
                                                                    />
                                                                ) : (
                                                                    <input
                                                                        type="text"
                                                                        className={ex.buttonTextInput}
                                                                        value={button.text}
                                                                        onChange={(e) => handleButtonChange(sectionIndex, itemIndex, buttonIndex, 'text', e.target.value)}
                                                                    />
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                                {isEditing ? (
                                    undefined
                                    // <button className={ex.createParameterButton}>Создать параметр</button>
                                ) : (
                                    undefined
                                )}
                            </div>
                        ) : (
                            <div className={ex.settingsContent}>Настройки недоступны</div>
                        )}
                    </>
                );
            case 'Metadata':
                return <div className={ex.metadataContent}>Страница "метаданные темы" в разработке</div>;
            default:
                return null;
        }
    };

    return (
        <Layout title="Стилизация">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <div className={styles.container0x0}>
                            {activeTab === 'Settings' ? <>
                                <button className={`${ex.edit} ${isEditing ? ex.activeEdit : ''}`} onClick={() => setIsEditing(prev => !prev)}>
                                    <MdEdit />
                                </button>
                            </> : ""}
                            <div className={ex.containerFix}>
                                <div
                                    className={ex.bannerBackground}
                                    style={{
                                        transition: 'height 0.5s ease, gap 0.5s ease',
                                        backgroundImage: `url(${bannerSrc})`,
                                        backgroundSize: 'cover',
                                        height: `${height}px`,
                                    }}
                                >
                                    <Button className={ex.hideButton} onClick={toggleExpand}>
                                        <MdKeyboardArrowDown size={20} style={isExpanded ? { 'transition': 'var(--transition)', 'rotate': '180deg' } : { 'transition': 'var(--transition)', 'rotate': '0deg' }} />
                                    </Button>
                                </div>
                                <div className={ex.themeInfo}>
                                    <div className={ex.themeHeader}>
                                        <div className={ex.containerLeft}>
                                            <img
                                                className={ex.themeImage}
                                                src={`${theme.path}/${theme.image}`}
                                                alt={`${theme.name} image`}
                                                width="100"
                                                height="100"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'static/assets/images/no_themeImage.png';
                                                }}
                                            />
                                            <div className={ex.themeTitle}>
                                                <div className={ex.titleContainer}>
                                                    <NavLink className={ex.path} to="/extensionbeta">
                                                        Extension
                                                    </NavLink>
                                                    /
                                                    <div className={ex.title}>
                                                        {theme.name || 'Название недоступно'}
                                                    </div>
                                                    <Button className={ex.addFavorite} disabled>
                                                        <MdBookmarkBorder size={20} />
                                                    </Button>
                                                </div>
                                                <div className={ex.authorInfo}>
                                                    {theme.author && <div>{theme.author}</div>} - {theme.lastModified && (
                                                        <div>Last update: {theme.lastModified}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className={ex.rightContainer}>
                                        <div className={ex.detailsContainer}>
                                            <div className={ex.detailInfo}>
                                                {theme.version && (
                                                    <div className={ex.box}>
                                                        <MdDesignServices /> {theme.version}
                                                    </div>
                                                )}
                                                {theme.size !== undefined && (
                                                    <div className={ex.box}>
                                                        <MdFolder /> {theme.size}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={ex.detailInfo}>
                                                {Array.isArray(theme.tags) && theme.tags.length > 0 && (
                                                    theme.tags.map((tag) => {
                                                        return (
                                                            <Button
                                                                key={tag}
                                                                className={ex.tag}
                                                                onClick={() => {
                                                                    handleTagChange(tag);
                                                                }}
                                                            >
                                                                {tag}
                                                            </Button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                        <div className={ex.miniButtonsContainer}>
                                            <Button
                                                className={`${ex.defaultButton} ${selectedTheme !== theme.name ? "" : ex.defaultButtonActive}`}
                                                onClick={selectedTheme !== theme.name ? handleEnableTheme : toggleTheme}
                                            >
                                                {selectedTheme !== theme.name ? 'Включить' : (isThemeEnabled ? 'Выключить' : 'Включить')}
                                            </Button>
                                            <Button className={ex.miniButton}>
                                                <MdMoreHoriz size={20} />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div className={ex.extensionNav}>
                                    <div className={ex.extensionNavContainer}>
                                        <button
                                            className={`${ex.extensionNavButton} ${activeTab === 'Overview' ? ex.activeTabButton : ''}`}
                                            onClick={() => setActiveTab('Overview')}
                                        >
                                            <MdExplore /> Overview
                                        </button>
                                        <button
                                            className={`${ex.extensionNavButton} ${activeTab === 'Settings' ? ex.activeTabButton : ''}`}
                                            onClick={() => setActiveTab('Settings')}
                                        >
                                            <MdSettings /> Settings
                                        </button>
                                        <button
                                            className={`${ex.extensionNavButton} ${activeTab === 'Metadata' ? ex.activeTabButton : ''}`}
                                            onClick={() => setActiveTab('Metadata')}
                                        >
                                            <MdStickyNote2 /> Metadata
                                        </button>

                                    </div>
                                    <button className={ex.extensionNavButton} disabled>
                                        <MdStoreMallDirectory /> Store
                                    </button>
                                </div>
                                <div className={ex.extensionContent}>
                                    {renderTabContent()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout >
    );
};

export default ExtensionViewPage;
