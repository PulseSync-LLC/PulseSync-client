import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as styles from './tooltip.module.scss'

interface TooltipButtonProps {
    tooltipText: string
    children: React.ReactNode
    onClick?: () => void
    side?: 'top' | 'right' | 'bottom' | 'left'
    dataSide?: 'top' | 'right' | 'bottom' | 'left'
    as?: 'button' | 'div'
    className?: string
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
    tooltipText,
    side = 'left',
    dataSide = 'left',
    children,
    onClick,
    as = 'button',
    className,
}) => {
    const Component = as
    return (
        <Tooltip.Provider delayDuration={100} skipDelayDuration={100}>
            <Tooltip.Root>
                <Tooltip.Trigger asChild>
                    <Component onClick={onClick} className={className}>
                        {children}
                    </Component>
                </Tooltip.Trigger>
                <Tooltip.Portal >
                    <Tooltip.Content className={styles.TooltipContent} data-side={dataSide} side={side} sideOffset={5}>
                        {tooltipText}
                        <Tooltip.Arrow className={styles.TooltipArrow} />
                    </Tooltip.Content>
                </Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
    )
}

export default TooltipButton
