import Layout from '../../components/layout'

import * as styles from './users.module.scss'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'

export default function UsersPage() {
    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        3
                    </div>
                </div>
            </div>
        </Layout>
    )
}
