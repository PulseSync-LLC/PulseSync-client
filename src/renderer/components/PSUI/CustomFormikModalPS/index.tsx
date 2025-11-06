import React, { ReactNode, useEffect, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Formik, Form, Field } from 'formik'
import ButtonV2 from '../../buttonV2'
import * as styles from './CustomModalPS.module.scss'

export interface ModalButton {
    text: string
    onClick: (values?: { input: string }) => void
    variant?: 'primary' | 'secondary' | 'danger'
    disabled?: boolean
    className?: string
}

export interface CustomFormikModalPSProps {
    isOpen: boolean
    onClose: () => void
    title?: string
    text?: string
    subText?: string
    children?: ReactNode
    buttons?: ModalButton[]
    initialInputValue?: string
    onSubmit: (values: { input: string }) => void
    inputPlaceholder?: string
}

const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.15 } },
    exit: { opacity: 0, transition: { duration: 0.15 } },
} as const

const modalVariants = {
    hidden: { opacity: 0, scale: 0.96, y: -12 },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { duration: 0.22, type: 'spring', stiffness: 300, damping: 24 },
    },
    exit: { opacity: 0, scale: 0.96, y: -12, transition: { duration: 0.15 } },
} as const

const CustomFormikModalPS: React.FC<CustomFormikModalPSProps> = ({
    isOpen,
    onClose,
    title,
    text,
    subText,
    children,
    buttons = [],
    initialInputValue = '',
    onSubmit,
    inputPlaceholder = 'Enter text',
}) => {
    if (typeof window === 'undefined') return null

    const isVertical = buttons.length > 2

    const titleId = useMemo(() => `modal-title-${Math.random().toString(36).slice(2)}`, [])
    const descId = useMemo(() => `modal-desc-${Math.random().toString(36).slice(2)}`, [])
    const firstBtnRef = useRef<HTMLButtonElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    useEffect(() => {
        if (!isOpen) return
        const t = setTimeout(() => {
            if (!inputRef.current) {
                firstBtnRef.current?.focus()
            } else {
                inputRef.current.focus()
            }
        }, 0)
        return () => clearTimeout(t)
    }, [isOpen])

    const renderButtons = (values: { input: string }) => {
        if (!buttons.length) return null

        const wrapperClass = [styles.buttonsWrapper, isVertical ? styles.buttonsVertical : styles.buttonsHorizontal].join(' ')

        return (
            <div className={wrapperClass}>
                {buttons.map(({ text, onClick, variant = 'primary', disabled, className }, idx) => {
                    const variantClass = styles[`btn_${variant}` as keyof typeof styles] || styles.btn_primary
                    const refProp = idx === 0 ? { ref: firstBtnRef } : {}
                    return (
                        <ButtonV2
                            key={`${text}-${idx}`}
                            onClick={() => onClick(values)}
                            disabled={disabled}
                            className={`${styles.btnBase} ${variantClass}${className ? ` ${className}` : ''}`}
                            {...refProp}
                        >
                            {text}
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
                        onClick={e => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        aria-describedby={text || subText ? descId : undefined}
                    >
                        <Formik initialValues={{ input: initialInputValue }} onSubmit={onSubmit}>
                            {({ values }) => (
                                <Form>
                                    {title && (
                                        <div id={titleId} className={styles.title}>
                                            {title}
                                        </div>
                                    )}

                                    {(text || subText) && (
                                        <div id={descId} className={styles.textBlock}>
                                            {text && <p className={styles.description}>{text}</p>}
                                            <Field name="input">
                                                {({ field }) => (
                                                    <input
                                                        {...field}
                                                        ref={inputRef}
                                                        type="text"
                                                        placeholder={inputPlaceholder}
                                                        className={styles.input}
                                                    />
                                                )}
                                            </Field>
                                            {subText && <p className={styles.subText}>{subText}</p>}
                                        </div>
                                    )}

                                    {children}

                                    <button type="submit" className={styles.hiddenSubmit} aria-hidden="true" tabIndex={-1} />

                                    {renderButtons(values)}
                                </Form>
                            )}
                        </Formik>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    )
}

export default CustomFormikModalPS
