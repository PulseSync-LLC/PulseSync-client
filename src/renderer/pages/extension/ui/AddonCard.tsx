import React from 'react'
import cn from 'clsx'
import { MdCheckCircle, MdIntegrationInstructions, MdInvertColors } from 'react-icons/md'

import Addon from '@entities/addon/model/addon.interface'
import * as extensionStylesV2 from '@pages/extension/extension.module.scss'

type Props = {
    addon: Addon
    currentTheme: string
    enabledScripts: string[]
    fallbackAddonImage: string
    getImagePath: (addon: Addon) => string
    isActive: boolean
    onClick: (addon: Addon) => void
    onDisable: (addon: Addon) => void
    onEnable: (addon: Addon) => void
}

export default function AddonCard({
    addon,
    currentTheme,
    enabledScripts,
    fallbackAddonImage,
    getImagePath,
    isActive,
    onClick,
    onDisable,
    onEnable,
}: Props) {
    const isEnabled = addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)

    return (
        <div
            key={addon.directoryName}
            className={cn(extensionStylesV2.addonCard, isActive && extensionStylesV2.addonCardSelected)}
            onClick={() => onClick(addon)}
        >
            <div
                className={cn(
                    extensionStylesV2.checkSelect,
                    addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript,
                )}
                style={isEnabled ? { marginRight: '12px', opacity: 1, cursor: 'pointer' } : { color: '#565F77' }}
                onClick={event => {
                    event.stopPropagation()
                    if (isEnabled) {
                        onDisable(addon)
                    } else {
                        onEnable(addon)
                    }
                }}
            >
                <MdCheckCircle size={18} />
            </div>
            <img
                src={getImagePath(addon)}
                alt={addon.name}
                className={extensionStylesV2.addonImage}
                loading="lazy"
                onError={event => {
                    event.currentTarget.src = fallbackAddonImage
                }}
            />
            <div className={extensionStylesV2.addonName}>{addon.name}</div>
            <div className={extensionStylesV2.addonType}>
                {addon.type === 'theme' ? <MdInvertColors size={isEnabled ? 24 : 21} /> : <MdIntegrationInstructions size={isEnabled ? 24 : 21} />}
            </div>
        </div>
    )
}
