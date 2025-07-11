import * as styles from './OptionMenu.module.scss'
import { MdCreateNewFolder, MdFolderOpen, MdRefresh } from 'react-icons/md'

interface OptionMenuProps {
    onReloadAddons: () => void
    onOpenAddonsDirectory: () => void
    onCreateNewAddon: () => void
}

export default function OptionMenu({ onReloadAddons, onOpenAddonsDirectory, onCreateNewAddon }: OptionMenuProps) {
    return (
        <div className={styles.filterWindow}>
            <div className={styles.filterGroup}>
                <div className={styles.filterTitle}>Опции</div>
                <button className={styles.checkboxLabel} onClick={onReloadAddons}>
                    <MdRefresh size={20} /> Перезагрузить расширения
                </button>
                <button className={styles.checkboxLabel} onClick={onOpenAddonsDirectory}>
                    <MdFolderOpen size={20} /> Директория аддонов
                </button>
                <button className={styles.checkboxLabel} onClick={onCreateNewAddon}>
                    <MdCreateNewFolder size={20} /> Создать новый аддон
                </button>
            </div>
        </div>
    )
}
