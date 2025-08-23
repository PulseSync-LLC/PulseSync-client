import { useCallback, useEffect, useState } from 'react'
import path from 'path'

import { AddonConfig, ButtonAction, TextItem } from '../../../../components/сonfigurationSettings/types'

type UseConfigResult = {
  configExists: boolean | null
  config: AddonConfig | null
  configApi: {
    reload: () => Promise<void>
    save: (cfg: AddonConfig) => Promise<void>
  }
}

const safeParse = <T,>(txt: string | null | undefined): T | null => {
  try {
    return txt ? (JSON.parse(txt) as T) : null
  } catch {
    return null
  }
}

export function useConfig(addonPath: string): UseConfigResult {
  const [configExists, setExists] = useState<boolean | null>(null)
  const [config, setConfig] = useState<AddonConfig | null>(null)

  const filePath = path.join(addonPath, 'handleEvents.json')

  const reload = useCallback(async () => {
    try {
      const raw = await window.desktopEvents?.invoke('file-event', 'read-file', filePath, 'utf-8')
      const parsed = safeParse<AddonConfig>(raw)
      setExists(!!parsed)
      setConfig(parsed)
    } catch {
      setExists(false)
      setConfig(null)
    }
  }, [filePath])

  const save = useCallback(async (cfg: AddonConfig) => {
    const normalized: AddonConfig = {
      sections: cfg.sections.map(s => ({
        ...s,
        items: s.items.map(it => {
          if (it.type !== 'text') return it
          const text = it as TextItem
          const buttons = text.buttons.map((b: ButtonAction) => ({
            ...b,
            text: String(b.text ?? ''),
            defaultParameter: String(b.defaultParameter ?? ''),
          }))
          return { ...text, buttons }
        }),
      })),
    }
    await window.desktopEvents?.invoke('file-event', 'write-file', filePath, JSON.stringify(normalized, null, 4))
    setConfig(normalized)
    setExists(true)
  }, [filePath])

  useEffect(() => {
    reload()
  }, [reload])

  return { configExists, config, configApi: { reload, save } }
}
