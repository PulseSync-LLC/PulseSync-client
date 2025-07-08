import React from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import Header from './optionHeader'
import * as pageStyles from '../layout/layout.module.scss'

interface OptionLayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const OptionLayout: React.FC<OptionLayoutProps> = ({ title, children, goBack }) => {
    return (
        <HelmetProvider>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <Header goBack={goBack} />
                <div className={pageStyles.main_window}>
                    <div className={pageStyles.options_container}>
                        {children}
                    </div>
                </div>
            </div>
        </HelmetProvider>
    )
}

export default OptionLayout