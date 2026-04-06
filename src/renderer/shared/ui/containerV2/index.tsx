import React, { CSSProperties } from 'react'
import * as styles from '@shared/ui/containerV2/container.module.scss'
import ButtonV2 from '@shared/ui/buttonV2'
import { staticAsset } from '@shared/lib/staticAssets'

interface p {
    titleName: string
    imageName?: string
    buttonName?: string
    onClick?: () => void
    children?: any
    style?: CSSProperties
    classNameButton?: string
}

const ContainerV2: React.FC<p> = ({ titleName, imageName, children, buttonName, onClick, style, classNameButton }) => {
    return (
        <>
            <div className={styles.mainContainer} style={style}>
                <div className={styles.left}>
                    <img src={staticAsset(`assets/container_icons/${imageName}.svg`)} alt={imageName} />
                    <div className={styles.title}>{titleName}</div>
                </div>
                {onClick && (
                    <ButtonV2 onClick={onClick} className={classNameButton}>
                        {buttonName}
                    </ButtonV2>
                )}
                {children}
            </div>
        </>
    )
}

export default ContainerV2
