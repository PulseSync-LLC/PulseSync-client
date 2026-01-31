import React, { useEffect } from 'react'
import { t } from '../i18n'

interface Addon {
    charCount: string
}

export function useCharCount(containerRef: React.RefObject<HTMLDivElement>, theme: Addon) {
    useEffect(() => {
        const container = containerRef.current

        if (!container) return

        const updateCharCount = (inputElement: HTMLInputElement | HTMLTextAreaElement, counterElement: HTMLElement) => {
            const maxLength = inputElement.maxLength > 0 ? inputElement.maxLength : null
            const currentLength = inputElement.value.length

            if (maxLength) {
                counterElement.textContent = t('utils.charCount.withMax', { currentLength, maxLength })
            } else {
                counterElement.textContent = t('utils.charCount.withoutMax', { currentLength })
            }
        }

        const createCharCountElement = (inputElement: HTMLInputElement | HTMLTextAreaElement) => {
            const counterId = `${inputElement.name}-char-count`
            let counterElement = document.getElementById(counterId)

            if (!counterElement) {
                counterElement = document.createElement('div')
                counterElement.id = counterId
                counterElement.className = theme.charCount || 'default-char-count'
                inputElement.parentNode?.insertBefore(counterElement, inputElement.nextSibling)
            }

            updateCharCount(inputElement, counterElement)

            inputElement.addEventListener('input', () => updateCharCount(inputElement, counterElement))
        }

        const textInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]')
        const textAreas = container.querySelectorAll<HTMLTextAreaElement>('textarea')

        textInputs.forEach(input => createCharCountElement(input))
        textAreas.forEach(textarea => createCharCountElement(textarea))
    }, [containerRef, theme])
}
