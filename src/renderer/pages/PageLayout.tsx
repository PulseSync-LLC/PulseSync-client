import React from 'react'
import clsx from 'clsx'
import Layout from '../components/layout'
import pageStyles from './pageStyles'

type PageLayoutProps = {
    title: string
    children: React.ReactNode
    containerRef?: React.Ref<HTMLDivElement>
    className?: string
}

const PageLayout: React.FC<PageLayoutProps> = ({ title, children, containerRef, className }) => {
    return (
        <Layout title={title}>
            <div className={pageStyles.page}>
                <div className={pageStyles.container}>
                    <div ref={containerRef} className={clsx(pageStyles.main_container, className)}>
                        {children}
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default PageLayout
