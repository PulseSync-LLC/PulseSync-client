import React from 'react'
import Container from '../../components/containerV2'
import OpitonLayout from '../../components/optionLayout/optionLayout'

import pageStyles from '../pageStyles'

function SettingsPage() {
    return (
        <OpitonLayout title="Настройки">
            <div className={pageStyles.page}>
                <Container titleName={'Настройки'} imageName={'settings'}>
                    Скоро
                </Container>
            </div>
        </OpitonLayout>
    )
}

export default SettingsPage
