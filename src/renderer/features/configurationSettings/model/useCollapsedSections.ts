import { useCallback, useEffect, useState } from 'react'

import { desktopApi } from '@shared/desktop/desktopApi'

import type { Section } from '@features/configurationSettings/types'
import type { Dispatch, SetStateAction } from 'react'

type CollapsedSections = Record<number, boolean>

export function useCollapsedSections(addonId: string, sections: Section[]) {
    const occurrences = new Map<string, number>()
    const sectionKeys = sections.map(section => {
        const occurrence = occurrences.get(section.title) ?? 0
        occurrences.set(section.title, occurrence + 1)
        return JSON.stringify([section.title, occurrence])
    })
    const [stored, setStored] = useState<Record<string, boolean>>(() => desktopApi.addons.getCollapsedSettingsSections(addonId))

    useEffect(() => {
        void desktopApi.addons.saveCollapsedSettingsSections(addonId, stored).catch(error => {
            console.warn('Failed to save addon settings section state', error)
        })
    }, [addonId, stored])

    const collapsed: CollapsedSections = Object.fromEntries(sectionKeys.map((key, index) => [index, stored[key] === true]))
    const setCollapsed: Dispatch<SetStateAction<CollapsedSections>> = useCallback(
        update => {
            setStored(previous => {
                const current = Object.fromEntries(sectionKeys.map((key, index) => [index, previous[key] === true]))
                const next = typeof update === 'function' ? update(current) : update
                return { ...previous, ...Object.fromEntries(sectionKeys.map((key, index) => [key, next[index] === true])) }
            })
        },
        [sectionKeys],
    )

    return [collapsed, setCollapsed] as const
}
