import React from 'react'
import Container from '@shared/ui/containerV2'
import OpitonLayout from '@shared/ui/optionLayout/optionLayout'
import { useTranslation } from 'react-i18next'

import pageStyles from '@widgets/layout/pageStyles'

function SettingsPage() {
    const { t } = useTranslation()
    return (
        <OpitonLayout title={t('pages.settings.title')}>
            <div className={pageStyles.page}>
                <Container titleName={t('pages.settings.title')} imageName={'settings'}>
                    {t('pages.settings.comingSoon')}
                </Container>
            </div>
        </OpitonLayout>
    )
}

export default SettingsPage
