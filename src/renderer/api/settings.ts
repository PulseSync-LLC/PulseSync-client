import SettingsInterface from './interfaces/settings.interface'
import React from 'react'
import settingsInitials from './initials/settings.initials'

export const fetchSettings = async (
    setApp: React.Dispatch<React.SetStateAction<SettingsInterface>>,
): Promise<void> => {
    const config: SettingsInterface = { ...settingsInitials }

    const iterateKeys = (obj: any, path: string[] = []): void => {
        Object.keys(obj).forEach(key => {
            const fullPath = [...path, key].join('.')
            const value = window.electron.store.get(fullPath)
            if (value !== undefined) {
                if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    iterateKeys(obj[key], [...path, key])
                } else {
                    obj[key] = value
                }
            }
        })
    }

    iterateKeys(config)
    setApp(config)
}
