import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'

import * as css from '@features/configurationSettings/ConfigurationSettings.module.scss'

import type { RefObject } from 'react'

type Props = {
    rootRef: RefObject<HTMLDivElement | null>
    sectionRefs: RefObject<(HTMLDivElement | null)[]>
    sectionId: string
    sections: { section: { title: string }; index: number }[]
    onNavigate: (index: number) => void
}

export default function ConfigurationNavigation({ rootRef, sectionRefs, sectionId, sections, onNavigate }: Props) {
    const { t } = useTranslation()
    const [activeSection, setActiveSection] = useState(0)
    const activeSectionRef = useRef(0)
    const scheduleUpdateRef = useRef<(() => void) | null>(null)
    const activateSection = useCallback((index: number) => {
        if (activeSectionRef.current === index) return
        activeSectionRef.current = index
        setActiveSection(index)
    }, [])

    useEffect(() => {
        const root = rootRef.current
        if (!root) return

        let scrollParent = root.parentElement
        while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) {
            scrollParent = scrollParent.parentElement
        }
        const scroller = scrollParent ?? document.documentElement
        const scrollTarget = scrollParent ?? document
        let frame: number | null = null
        const updateActiveSection = () => {
            frame = null
            const elements = sectionRefs.current
            const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
            let current = -1

            if (atBottom) {
                for (let index = elements.length - 1; index >= 0; index--) {
                    const element = elements[index]
                    if (element && !element.hidden) {
                        current = index
                        break
                    }
                }
            } else {
                const top = (scrollParent?.getBoundingClientRect().top ?? 0) + 24
                for (let index = 0; index < elements.length; index++) {
                    const element = elements[index]
                    if (!element || element.hidden) continue
                    if (current === -1) current = index
                    if (element.getBoundingClientRect().top > top) break
                    current = index
                }
            }
            if (current !== -1) activateSection(current)
        }
        const scheduleUpdate = () => {
            if (frame === null) frame = requestAnimationFrame(updateActiveSection)
        }
        scheduleUpdateRef.current = scheduleUpdate
        const observer = new ResizeObserver(scheduleUpdate)
        observer.observe(root)
        observer.observe(scroller)
        scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true })
        window.addEventListener('resize', scheduleUpdate)
        scheduleUpdate()
        return () => {
            if (frame !== null) cancelAnimationFrame(frame)
            scheduleUpdateRef.current = null
            observer.disconnect()
            scrollTarget.removeEventListener('scroll', scheduleUpdate)
            window.removeEventListener('resize', scheduleUpdate)
        }
    }, [rootRef, sectionRefs, activateSection])

    useLayoutEffect(() => {
        scheduleUpdateRef.current?.()
    }, [sections])

    return (
        <nav className={css.navigation} aria-label={t('settingsModal.category')}>
            <Tooltip.Provider delayDuration={100} skipDelayDuration={100}>
                <div className={css.navigationList}>
                    {sections.map(({ section, index }) => (
                        <Tooltip.Root key={index}>
                            <Tooltip.Trigger asChild>
                                <button
                                    type="button"
                                    className={css.navigationItem}
                                    aria-label={`${index + 1}. ${section.title}`}
                                    aria-current={activeSection === index ? 'location' : undefined}
                                    aria-controls={`${sectionId}-heading-${index}`}
                                    onClick={() => {
                                        activateSection(index)
                                        onNavigate(index)
                                    }}
                                >
                                    <span className={css.navigationTick} aria-hidden="true" />
                                </button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                                <Tooltip.Content className={css.navigationTooltip} side="right" sideOffset={8} collisionPadding={12}>
                                    <span className={css.navigationNumber}>{index + 1}</span>
                                    <span>{section.title}</span>
                                </Tooltip.Content>
                            </Tooltip.Portal>
                        </Tooltip.Root>
                    ))}
                </div>
            </Tooltip.Provider>
        </nav>
    )
}
