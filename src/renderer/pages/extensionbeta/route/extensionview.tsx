// extensionbeta/route/extensionview.tsx

import React, { useEffect, useState } from 'react';
import Layout from '../../../components/layout';
import * as styles from '../../../../../static/styles/page/index.module.scss';
import * as ex from './extensionview.module.scss';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import ThemeInterface from '../../../api/interfaces/theme.interface';
import Button from '../../../components/button';
import { MdBookmarkBorder, MdDesignServices, MdFolder, MdKeyboardArrowDown, MdKeyboardArrowRight, MdMoreHoriz } from 'react-icons/md';

const ExtensionViewPage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const theme = location.state?.theme as ThemeInterface;
    const [bannerSrc, setBannerSrc] = useState('static/assets/images/no_themeBackground.png');
    const [selectedTheme, setSelectedTheme] = useState(window.electron.store.get('theme') || 'Default');
    const [isThemeEnabled, setIsThemeEnabled] = useState(selectedTheme !== 'Default');
    const [isExpanded, setIsExpanded] = useState(false);
    const [height, setHeight] = useState(84);

    const toggleTheme = () => {
        const newTheme = isThemeEnabled ? 'Default' : theme.name;
        window.electron.store.set('theme', newTheme);
        setSelectedTheme(newTheme);
        window.desktopEvents.send('themeChanged', newTheme);
        setIsThemeEnabled(!isThemeEnabled);
    };

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
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

    return (
        <Layout title="Стилизация">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <div className={styles.container0x0}>
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
                                                        { theme.name || 'Название недоступно' }
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
                                            className={`${ex.defaultButton } ${selectedTheme !== theme.name ? "" : ex.defaultButtonActive}`}
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
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </Layout >
    );
};

export default ExtensionViewPage;
