import * as styles from './OptionMenu.module.scss'
import { MdCreateNewFolder, MdFolderOpen, MdRefresh } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

interface OptionMenuProps {
    onReloadAddons: () => void
    onOpenAddonsDirectory: () => void
    onCreateNewAddon: () => void
}

export default function OptionMenu({ onReloadAddons, onOpenAddonsDirectory, onCreateNewAddon }: OptionMenuProps) {
    const { t } = useTranslation()
    return (
        <div className={styles.filterWindow}>
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>{t('options.title')}</div>
                <button className={styles.checkboxLabel} onClick={onReloadAddons}>
                    <MdRefresh size={20} /> {t('options.reloadAddons')}
                </button>
                <button className={styles.checkboxLabel} onClick={onOpenAddonsDirectory}>
                    <MdFolderOpen size={20} /> {t('options.addonsDirectory')}
                </button>
                <button className={styles.checkboxLabel} onClick={onCreateNewAddon}>
                    <MdCreateNewFolder size={20} /> {t('options.createAddon')}
                </button>
            </div>
        </div>
    )
}
