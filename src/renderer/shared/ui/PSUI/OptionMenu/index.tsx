import * as styles from '@shared/ui/PSUI/OptionMenu/OptionMenu.module.scss'
import { MdCreateNewFolder, MdDeleteOutline, MdFolderOpen, MdRefresh } from 'react-icons/md'
import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopAddonOrganizationCategory } from '@common/desktopApi/contract'

interface OptionMenuProps {
    onReloadAddons: () => void
    onOpenAddonsDirectory: () => void
    onCreateNewAddon: () => void
    onCreateCategory?: () => void
    onDeleteCategory?: (categoryId: string, categoryName: string) => void
    categories?: DesktopAddonOrganizationCategory[]
    onOpenChange?: (open: boolean) => void
    children: ReactNode
}

export default function OptionMenu({
    onReloadAddons,
    onOpenAddonsDirectory,
    onCreateNewAddon,
    onCreateCategory,
    onDeleteCategory,
    categories = [],
    onOpenChange,
    children,
}: OptionMenuProps) {
    const { t } = useTranslation()
    const items: DropdownMenuItem[] = [
        { key: 'reload', label: t('options.reloadAddons'), icon: <MdRefresh />, onClick: onReloadAddons },
        { key: 'directory', label: t('options.addonsDirectory'), icon: <MdFolderOpen />, onClick: onOpenAddonsDirectory },
        { key: 'create-addon', label: t('options.createAddon'), icon: <MdCreateNewFolder />, onClick: onCreateNewAddon, divider: true },
        ...(onCreateCategory
            ? [
                  {
                      key: 'create-category',
                      label: t('extensions.organization.createCategory'),
                      icon: <MdCreateNewFolder />,
                      onClick: onCreateCategory,
                  },
              ]
            : []),
        ...(onDeleteCategory && categories.length
            ? [
                  {
                      key: 'delete-category',
                      label: t('extensions.organization.deleteCategory'),
                      icon: <MdDeleteOutline />,
                      children: categories.map(category => ({
                          key: `delete-category-${category.id}`,
                          label: category.name,
                          onClick: () => onDeleteCategory(category.id, category.name),
                      })),
                  },
              ]
            : []),
    ]

    return (
        <DropdownMenu items={items} menuClassName={styles.menu} placement="right-start" onOpenChange={onOpenChange}>
            {children}
        </DropdownMenu>
    )
}
