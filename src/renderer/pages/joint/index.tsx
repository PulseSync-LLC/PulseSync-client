import { useTranslation } from 'react-i18next'

import PageLayout from '@widgets/layout/PageLayout'
import Container from '@shared/ui/containerV2'

export default function JointPage() {
    const { t } = useTranslation()
    return (
        <PageLayout title={t('pages.joint.title')}>
            <Container titleName={t('pages.joint.title')}>{t('pages.joint.comingSoon')}</Container>
        </PageLayout>
    )
}
