// extensionbeta/route/extensionview.tsx

import React, { useEffect, useState } from 'react'
import Layout from '../../../components/layout'

import * as styles from '../../../../../static/styles/page/index.module.scss'
import * as ex from './extensionview.module.scss'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import ThemeInterface from '../../../api/interfaces/theme.interface'
import Button from '../../../components/button'
import { MdBookmarkBorder, MdDesignServices, MdFolder, MdKeyboardArrowRight, MdMoreHoriz } from 'react-icons/md'

const ExtensionViewPage: React.FC = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const theme = location.state?.theme as ThemeInterface
    const [bannerSrc, setBannerSrc] = useState('static/assets/images/no_themeImage.png');
    const [isThemeEnabled, setIsThemeEnabled] = useState(true); // По умолчанию включена

    const toggleTheme = () => {
        setIsThemeEnabled(prevState => !prevState);
    };

    const formatPath = (path: string) => {
        return encodeURI(path.replace(/\\/g, '/'));
    };

    const handleTagChange = (tag: string) => {
        navigate(`/extensionbeta?selectedTag=${encodeURIComponent(tag)}`);
    };

    if (!theme) {
        navigate('/extensionbeta')
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
                    setBannerSrc('static/assets/images/no_themeImage.png');
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
                                        backgroundImage: `linear-gradient(0deg, #1E2027 0%, rgb(30 32 39 / 90%) 75%), url(${bannerSrc})`,
                                        backgroundSize: 'cover',
                                    }}
                                >
                                    <div className={ex.navContainer}>
                                        <NavLink className={ex.navLink} to="/extensionbeta">
                                            Extension
                                        </NavLink>
                                        <div className={ex.navText}>
                                            <MdKeyboardArrowRight />
                                            {theme.name || 'Название недоступно'}
                                        </div>
                                    </div>
                                    <div className={ex.imageContainer}>
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
                                        <div className={ex.themeInfo}>
                                            <div className={ex.themeHeader}>
                                                <div className={ex.themeTitle}>
                                                    {theme.name || 'Название недоступно'}
                                                    <div className={ex.rating}>⭐️⭐️⭐️⭐️⭐️</div>
                                                    <div className={ex.authorInfo}>
                                                        {theme.author && <div>{theme.author}</div>} - {theme.lastModified && (
                                                            <div>{theme.lastModified}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className={ex.buttonGroup}>
                                                    <Button className={ex.defaultButton} onClick={toggleTheme}>
                                                        {isThemeEnabled ? 'Выключить' : 'Включить'}
                                                    </Button>
                                                    <Button className={ex.miniButton} disabled>
                                                        <MdBookmarkBorder size={20} />
                                                    </Button>
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
                                                <Button className={ex.miniButton}>
                                                    <MdMoreHoriz size={20} />
                                                </Button>
                                            </div>
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
        </Layout>
    );
};

export default ExtensionViewPage;
