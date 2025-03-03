import React from 'react'
import * as styles from './container.module.scss'
import Button from '../button'

interface p {
    titleName: string
    description?: string
    className?: string
    imageName?: string
    buttonName?: string
    onClick?: () => void
    children?: any
}

const Container: React.FC<p> = ({ titleName, description, className, imageName, children, buttonName, onClick }) => {
    return (
        <>
            <div className={`${styles.container} ${className ? className : ''}`}>
                <div className={styles.mainContainer}>
                    <div className={styles.left}>
                        <div className={styles.imageContainer}>
                            <img src={`static/assets/container_icons/${imageName}.svg`} alt={imageName} />
                        </div>
                        <div className={styles.detailPage}>
                            <div className={styles.title}>{titleName}</div>
                            <div className={styles.description}>{description}</div>
                        </div>
                    </div>
                    {onClick && <Button onClick={onClick}>{buttonName}</Button>}
                    {children}
                </div>
            </div>
        </>
    )
}

export default Container
