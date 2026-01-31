import React from 'react'
import Container from '../../components/containerV2'
import OpitonLayout from '../../components/optionLayout/optionLayout'
import { useTranslation } from 'react-i18next'

import pageStyles from '../pageStyles'

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
