import { useCallback, useEffect, useState } from 'react'
import path from 'path'

import { AddonConfig, Item, TextItem, ButtonAction } from '../../../../components/сonfigurationSettings/types'

import { isTextItem, setNestedValue } from './utils'

export function useConfig(addonPath: string, initConfig: AddonConfig | null) {
    const [config, setConfig] = useState<AddonConfig | null>(initConfig)
    const [newSectionTitle, setNewSectionTitle] = useState('')

    useEffect(() => {
        setConfig(initConfig)
    }, [initConfig])

    const write = async (upd: AddonConfig) => {
        setConfig(upd)
        const cfgPath = path.join(addonPath, 'handleEvents.json')
        await window.desktopEvents?.invoke('file-event', 'write-file', cfgPath, JSON.stringify(upd, null, 4))
    }

    const updateConfigField = useCallback(
        (sec: number, itm: number | null, key: string, val: any) => {
            if (!config) return
            const upd = structuredClone(config)
            itm !== null ? setNestedValue(upd.sections[sec].items[itm], key, val) : setNestedValue(upd.sections[sec], key, val)
            write(upd)
        },
        [config],
    )

    const updateButtonConfig = useCallback(
        (sec: number, itm: number, btn: number, key: keyof ButtonAction, val: string) => {
            if (!config) return
            const upd = structuredClone(config)
            const it = upd.sections[sec].items[itm]
            if (isTextItem(it) && it.buttons[btn]) it.buttons[btn][key] = val
            write(upd)
        },
        [config],
    )

    const resetConfigField = useCallback(
        (sec: number, itm: number) => {
            if (!config) return
            const upd = structuredClone(config)
            const it = upd.sections[sec].items[itm]

            switch (it.type) {
                case 'button':
                    it.bool = it.defaultParameter
                    break
                case 'color':
                    it.input = it.defaultParameter
                    break
                case 'text':
                    ;(it as TextItem).buttons.forEach(b => (b.text = b.defaultParameter ?? b.text))
                    break
                case 'slider':
                    it.value = it.defaultParameter ?? 0
                    break
                case 'file':
                    it.filePath = it.defaultParameter?.filePath ?? ''
                    break
            }
            write(upd)
        },
        [config],
    )

    const resetButtonConfig = useCallback(
        (sec: number, itm: number, btn: number) => {
            if (!config) return
            const upd = structuredClone(config)
            const it = upd.sections[sec].items[itm]
            if (isTextItem(it) && it.buttons[btn]) it.buttons[btn].text = it.buttons[btn].defaultParameter ?? it.buttons[btn].text
            write(upd)
        },
        [config],
    )

    const addSection = useCallback(() => {
        if (!newSectionTitle.trim() || !config) return
        const upd = structuredClone(config)
        upd.sections.push({ title: newSectionTitle.trim(), items: [] })
        setNewSectionTitle('')
        write(upd)
    }, [newSectionTitle, config])

    const removeSection = useCallback(
        (sec: number) => {
            if (!config) return
            const upd = structuredClone(config)
            upd.sections.splice(sec, 1)
            write(upd)
        },
        [config],
    )

    const addItem = useCallback(
        (sec: number, item: Item) => {
            if (!config) return
            const upd = structuredClone(config)
            upd.sections[sec].items.push(item)
            write(upd)
        },
        [config],
    )

    const removeItem = useCallback(
        (sec: number, idx: number) => {
            if (!config) return
            const upd = structuredClone(config)
            upd.sections[sec].items.splice(idx, 1)
            write(upd)
        },
        [config],
    )

    return {
        config,
        newSectionTitle,
        setNewSectionTitle,
        updateConfigField,
        updateButtonConfig,
        resetConfigField,
        resetButtonConfig,
        addSection,
        removeSection,
        addItem,
        removeItem,
    }
}
