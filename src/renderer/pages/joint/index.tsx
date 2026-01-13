import PageLayout from '../PageLayout'
import Container from '../../components/containerV2'
import { useTranslation } from 'react-i18next'

export default function JointPage() {
    const { t } = useTranslation()
    return (
        <PageLayout title={t('pages.joint.title')}>
            <Container titleName={t('pages.joint.title')}>{t('pages.joint.comingSoon')}</Container>
        </PageLayout>
    )
}
