import React, { ReactNode, useEffect, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ButtonV2 from '../../buttonV2'
import * as styles from './CustomModalPS.module.scss'

export interface ModalButton {
    text: string
    onClick: () => void
    variant?: 'primary' | 'secondary' | 'danger'
    disabled?: boolean
    className?: string
}

export interface CustomModalPSProps {
    isOpen: boolean
    onClose: () => void
    title?: string
    text?: string
    subText?: string
    children?: ReactNode
    buttons?: ModalButton[]
}

const backdropVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { duration: 0.15, ease: 'easeOut' },
    },
    exit: {
        opacity: 0,
        transition: { duration: 0.15, ease: 'easeIn' },
    },
} as const

const modalVariants = {
    hidden: {
        opacity: 0,
        y: -8,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: 'easeOut' },
    },
    exit: {
        opacity: 0,
        y: -8,
        transition: { duration: 0.15, ease: 'easeIn' },
    },
} as const

const CustomModalPS: React.FC<CustomModalPSProps> = ({ isOpen, onClose, title, text, subText, children, buttons = [] }) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return null
    }

    const isVertical = buttons.length > 2

    const titleId = useMemo(() => `modal-title-${Math.random().toString(36).slice(2)}`, [])
    const descId = useMemo(() => `modal-desc-${Math.random().toString(36).slice(2)}`, [])

    const firstBtnRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
        if (!isOpen) return

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose()
            }
        }

        document.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [isOpen, onClose])

    useEffect(() => {
        if (!isOpen) return
        if (!buttons.length) return

        const timer = window.setTimeout(() => {
            firstBtnRef.current?.focus()
        }, 0)

        return () => {
            window.clearTimeout(timer)
        }
    }, [isOpen, buttons.length])

    const renderButtons = () => {
        if (!buttons.length) return null

        const wrapperClass = `${styles.buttonsWrapper} ${isVertical ? styles.buttonsVertical : styles.buttonsHorizontal}`

        return (
            <div className={wrapperClass}>
                {buttons.map(({ text: btnText, onClick, variant = 'primary', disabled, className }, index) => {
                    const variantClass = styles[`btn_${variant}` as keyof typeof styles] ?? styles.btn_primary

                    const refProp = index === 0 ? { ref: firstBtnRef } : {}

                    return (
                        <ButtonV2
                            key={`${btnText}-${index}`}
                            onClick={onClick}
                            disabled={disabled}
                            className={`${styles.btnBase} ${variantClass}${className ? ` ${className}` : ''}`}
                            {...refProp}
                        >
                            {btnText}
                        </ButtonV2>
                    )
                })}
            </div>
        )
    }

    return ReactDOM.createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="backdrop"
                    className={styles.backdrop}
                    variants={backdropVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    onClick={onClose}
                    aria-hidden="true"
                >
                    <motion.div
                        key="modal"
                        className={styles.modal}
                        variants={modalVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        onClick={event => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        aria-describedby={text || subText ? descId : undefined}
                    >
                        {title && (
                            <div id={titleId} className={styles.title}>
                                {title}
                            </div>
                        )}

                        {(text || subText) && (
                            <div id={descId} className={styles.textBlock}>
                                {text && <p className={styles.description}>{text}</p>}
                                {subText && <p className={styles.subText}>{subText}</p>}
                            </div>
                        )}

                        {children}

                        {renderButtons()}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    )
}

export default CustomModalPS
