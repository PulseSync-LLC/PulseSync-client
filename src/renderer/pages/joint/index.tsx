import Layout from '../../components/layout'
import Container from '../../components/containerV2'

import * as styles from '../../../../static/styles/page/index.module.scss'

export default function JointPage() {
    return (
        <Layout title="Совместное прослушивание">
            <div className={styles.page}>
                <Container titleName={'Совместное прослушивание'}>Скоро</Container>
            </div>
        </Layout>
    )
}
