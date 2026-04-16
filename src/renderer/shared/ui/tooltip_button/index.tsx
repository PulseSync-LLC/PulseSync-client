import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as styles from '@shared/ui/tooltip_button/tooltip.module.scss'

type Side = 'top' | 'right' | 'bottom' | 'left'

interface TooltipButtonProps {
    tooltipText: React.ReactNode
    children: React.ReactNode
    onClick?: () => void
    side?: Side
    dataSide?: Side | undefined
    as?: 'button' | 'div' | 'span'
    disabled?: boolean
    tipEnabled?: boolean
    className?: string
    style?: React.CSSProperties
    styleComponent?: React.CSSProperties
}

const dataSideDefault = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
    tooltipText,
    side = 'left',
    dataSide = undefined,
    children,
    onClick,
    as = 'button',
    disabled,
    tipEnabled = true,
    className,
    style,
    styleComponent,
}) => {
    const Component = as
    if (!tipEnabled) {
        return (
            <Component onClick={onClick} className={className} disabled={disabled} style={style}>
                {children}
            </Component>
        )
    }
    return (
        <Tooltip.Provider delayDuration={100} skipDelayDuration={100}>
            <Tooltip.Root>
                <Tooltip.Trigger asChild>
                    <Component onClick={onClick} className={className} disabled={disabled} style={style}>
                        {children}
                    </Component>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                    <Tooltip.Content
                        className={styles.TooltipContent}
                        data-side={dataSide ?? dataSideDefault[side]}
                        side={side}
                        sideOffset={5}
                        style={styleComponent}
                    >
                        {tooltipText}
                        <Tooltip.Arrow className={styles.TooltipArrow} />
                    </Tooltip.Content>
                </Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
    )
}

export default TooltipButton
