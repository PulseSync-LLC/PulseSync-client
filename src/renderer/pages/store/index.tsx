import PageLayout from '../PageLayout'
import * as st from './store.module.scss'

import ExtensionCardStore from '../../components/PSUI/ExtensionCardStore'
import { useTranslation } from 'react-i18next'

export default function StorePage() {
    const { t } = useTranslation()
    const iconMusicPlayer = 'https://i.ibb.co/L5Q2Zf8/betterplayer-icon.png'
    const bgAbstractPurple = 'https://i.ibb.co/X3S2nJj/abstract-purple-bg.jpg'
    const iconLyrics = 'https://i.ibb.co/6P6XyRj/lyrics-icon.png'
    const bgRedWave = 'https://i.ibb.co/hR4y5T0/red-soundwave-bg.jpg'
    const iconPalette = 'https://i.ibb.co/B3T5G1L/colorize-icon.png'
    const bgNeonWave = 'https://i.ibb.co/JzG9g8Z/neon-wave-bg.jpg'
    const iconDeprecated = 'https://i.ibb.co/k5Vp9XF/deprecated-icon.png'
    const iconVolume = 'https://i.ibb.co/h5P0L0R/volume-icon.png'

    return (
        <PageLayout title={t('pages.store.title')}>
            <section className={st.store}>
                <header className={st.store_header}>
                    <div className={st.store_title}>{t('pages.store.headerTitle')}</div>
                    <div className={st.store_subtitle}>{t('pages.store.headerSubtitle')}</div>
                </header>

                <div className={st.store_grid}>
                    {}
                    <ExtensionCardStore
                        theme="purple"
                        title="BetterPlayer"
                        subtitle={t('pages.store.cards.betterPlayer')}
                        version="v1.4.0"
                        authors={['WolfySoCute']}
                        downloads="1.2K"
                        status="active"
                        type="js"
                        backgroundImage="https://embed.pixiv.net/artwork.php?illust_id=93909354&mdate=1635997641"
                        iconImage="https://images.steamusercontent.com/ugc/2042985641591101872/327A7E5C36F308E8D31EBFFFA2E8EFF6E5FB19D1/?imw=5000&imh=5000&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false"
                        onDownloadClick={() => {
                            console.log('[Store] download BetterPlayer')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors BetterPlayer')
                        }}
                    />

                    {}
                    <ExtensionCardStore
                        theme="red"
                        title="Reachtext"
                        subtitle={t('pages.store.cards.reachtext')}
                        version="v2.2.2"
                        authors={['Hazzz895']}
                        downloads="3.5K"
                        status="active"
                        type="js"
                        iconImage={iconLyrics}
                        backgroundImage={bgRedWave}
                        onDownloadClick={() => {
                            console.log('[Store] download Reachtext')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors Reachtext')
                        }}
                    />

                    {}
                    <ExtensionCardStore
                        theme="wave"
                        title="Colorize 2"
                        subtitle={t('pages.store.cards.colorize')}
                        version="v1.1.3"
                        authors={['maks1mio', 'imperiadicks']}
                        downloads="1.2K"
                        status="active"
                        type="css"
                        iconImage={iconPalette}
                        backgroundImage={bgNeonWave}
                        onDownloadClick={() => {
                            console.log('[Store] download Colorize 2 #1')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors Colorize 2')
                        }}
                    />

                    {}
                    <ExtensionCardStore
                        theme="purple"
                        title="Custom UI"
                        subtitle={t('pages.store.cards.customUi')}
                        version="v1.0.0"
                        authors={['WolfySoCute']}
                        downloads="800"
                        status="active"
                        iconImage={iconPalette}
                        backgroundImage={bgNeonWave}
                        type="both"
                        onDownloadClick={() => {
                            console.log('[Store] download Custom UI')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors Custom UI')
                        }}
                    />

                    {}
                    <ExtensionCardStore
                        theme="wave"
                        title="Theme Generator"
                        subtitle={t('pages.store.cards.themeGenerator')}
                        version="v0.9.0"
                        authors={['maks1mio']}
                        downloads="300"
                        status="active"
                        iconImage={iconPalette}
                        backgroundImage={bgNeonWave}
                        type="js"
                        onDownloadClick={() => {
                            console.log('[Store] download Theme Generator')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors Theme Generator')
                        }}
                    />

                    {}
                    <ExtensionCardStore
                        theme="red"
                        title="Volume Control"
                        subtitle={t('pages.store.cards.volumeControl')}
                        version="v1.0.5"
                        authors={['imperiadicks']}
                        downloads="500"
                        status="deprecated"
                        type="js"
                        iconImage={iconPalette}
                        backgroundImage={bgNeonWave}
                        onDownloadClick={() => {
                            console.log('[Store] download Volume Control')
                        }}
                        onAuthorsClick={() => {
                            console.log('[Store] authors Volume Control')
                        }}
                    />

                    {}
                    <div className={st.placeholder_card} />
                    <div className={st.placeholder_card} />
                </div>
            </section>
        </PageLayout>
    )
}
