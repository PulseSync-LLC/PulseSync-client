import React from 'react'
import Container from '../../components/containerV2'
import OpitonLayout from '../../components/optionLayout/optionLayout'

import * as styles from '../../../../static/styles/page/index.module.scss'

function SettingsPage() {
    return (
        <OpitonLayout title="Настройки">
            <div className={styles.page}>
                <Container titleName={'Настройки'} imageName={'settings'}>
                    Скоро
                </Container>
            </div>
        </OpitonLayout>
    )
}

export default SettingsPage
