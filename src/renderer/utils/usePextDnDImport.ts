import { useEffect } from 'react'
import MainEvents from '../../common/types/mainEvents'

const PEXT_EXT = '.pext'

const isPext = (value: string): boolean => value.toLowerCase().endsWith(PEXT_EXT)

const hasFilePayload = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types
    return !!types && Array.from(types).includes('Files')
}

const getFileNames = (event: DragEvent): string[] => {
    const byFiles = event.dataTransfer?.files ? Array.from(event.dataTransfer.files).map(file => file.name) : []
    const byItems = event.dataTransfer?.items
        ? Array.from(event.dataTransfer.items)
              .filter(item => item.kind === 'file')
              .map(item => item.getAsFile()?.name || '')
        : []
    return Array.from(new Set([...byFiles, ...byItems].filter(Boolean)))
}

const isUnsupportedPayload = (event: DragEvent): boolean => {
    const names = getFileNames(event)
    return names.length > 0 && names.some(name => !isPext(name))
}

const getUriValues = (event: DragEvent): string[] => {
    const uriList = event.dataTransfer?.getData('text/uri-list') || ''
    const plainText = event.dataTransfer?.getData('text/plain') || ''
    return [uriList, plainText]
        .flatMap(raw => raw.split(/\r?\n/))
        .map(value => value.trim())
        .filter(value => value.length > 0 && !value.startsWith('#'))
}

const getPextPath = (event: DragEvent): string | null => {
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : []
    const file = files.find(entry => isPext(entry.name)) as (File & { path?: string }) | undefined
    if (file?.path) return file.path
    return getUriValues(event).find(value => isPext(value)) || null
}

const setDropEffect = (event: DragEvent, effect: DataTransfer['dropEffect']): void => {
    event.preventDefault()
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = effect
    }
}

export function usePextDnDImport(): void {
    useEffect(() => {
        if (typeof window === 'undefined' || !window.desktopEvents) return

        const onDrag = (event: DragEvent): void => {
            if (!hasFilePayload(event)) return
            setDropEffect(event, isUnsupportedPayload(event) ? 'none' : 'copy')
        }

        const onDrop = async (event: DragEvent): Promise<void> => {
            if (!hasFilePayload(event)) return
            if (isUnsupportedPayload(event)) {
                setDropEffect(event, 'none')
                return
            }

            const pextPath = getPextPath(event)
            if (!pextPath) return
            setDropEffect(event, 'copy')

            try {
                await window.desktopEvents.invoke(MainEvents.IMPORT_PEXT_FILE, pextPath)
            } catch (error) {
                console.error('Failed to import dropped .pext file:', error)
            }
        }

        const bind = (mode: 'add' | 'remove') => {
            const targets: Array<Document | Window> = [document, window]
            const method = mode === 'add' ? 'addEventListener' : 'removeEventListener'
            targets.forEach(target => {
                target[method]('dragenter', onDrag as EventListener, true)
                target[method]('dragover', onDrag as EventListener, true)
                target[method]('drop', onDrop as EventListener, true)
            })
        }

        bind('add')

        return () => {
            bind('remove')
        }
    }, [])
}
