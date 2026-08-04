import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import * as extensionStylesV2 from '@pages/extension/extension.module.scss'

type Props = {
    hasAnyAddons: boolean
}

export default function ThemeNotFound({ hasAnyAddons }: Props) {
    const { t } = useTranslation()

    return (
        <div className={extensionStylesV2.notFound}>
            <h2>{hasAnyAddons ? t('extensions.notFound.titleFiltered') : t('extensions.notFound.titleEmpty')}</h2>
            <p>{hasAnyAddons ? t('extensions.notFound.filteredDescription') : t('extensions.notFound.emptyDescription')}</p>
            <Link to="/store">{t('extensions.notFound.catalogLink')}</Link>
        </div>
    )
}
