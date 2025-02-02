import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as styles from './tooltip.module.scss'

interface TooltipButtonProps {
    tooltipText: React.ReactNode
    children: React.ReactNode
    onClick?: () => void
    side?: 'top' | 'right' | 'bottom' | 'left'
    dataSide?: 'top' | 'right' | 'bottom' | 'left'
    as?: 'button' | 'div' | 'span'
    disabled?: boolean
    className?: string
    style?: React.CSSProperties
    styleComponent?: React.CSSProperties
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
    tooltipText,
    side = 'left',
    dataSide = 'left',
    children,
    onClick,
    as = 'button',
    disabled,
    className,
    style,
    styleComponent,
}) => {
    const Component = as
    return (
        <Tooltip.Provider delayDuration={100} skipDelayDuration={100}>
            <Tooltip.Root>
                <Tooltip.Trigger asChild>
                    <Component
                        onClick={onClick}
                        className={className}
                        disabled={disabled}
                        style={style}
                    >
                        {children}
                    </Component>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                    <Tooltip.Content
                        className={styles.TooltipContent}
                        data-side={dataSide}
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
