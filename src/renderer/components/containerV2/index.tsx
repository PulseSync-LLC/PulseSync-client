import React from 'react'
import * as styles from './container.module.scss'
import ButtonV2 from '../buttonV2'

interface p {
    titleName: string
    imageName?: string
    buttonName?: string
    onClick?: () => void
    children?: any
}

const ContainerV2: React.FC<p> = ({ titleName, imageName, children, buttonName, onClick }) => {
    return (
        <>
            <div className={styles.mainContainer}>
                <div className={styles.left}>
                    <img src={`static/assets/container_icons/${imageName}.svg`} alt={imageName} />
                    <div className={styles.title}>{titleName}</div>
                </div>
                {onClick && <ButtonV2 onClick={onClick}>{buttonName}</ButtonV2>}
                {children}
            </div>
        </>
    )
}

export default ContainerV2
