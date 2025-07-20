import logger from './logger'
import { getStore, StoreType } from './storage'

class State {
    private store: StoreType
    private readonly state: Record<string, any>

    constructor() {
        this.store = getStore() as StoreType
        this.state = {
            ...this.store.getAll(),
        }
        logger.main.info('State initialized with:', this.state)
    }

    public get(key: string): any {
        const keys = key.split('.')
        let result: any = this.state
        for (const k of keys) {
            if (result == null || typeof result !== 'object') {
                return undefined
            }
            result = result[k]
        }
        return result
    }

    public set(key: string, value: any): void {
        const keys = key.split('.')
        let obj: any = this.state
        for (let i = 0; i < keys.length - 1; i++) {
            const segment = keys[i]
            if (obj[segment] == null || typeof obj[segment] !== 'object') {
                obj[segment] = {}
            }
            obj = obj[segment]
        }
        obj[keys[keys.length - 1]] = value

        this.store.set(key, value)
    }

    public delete(key: string): void {
        const keys = key.split('.')
        let obj: any = this.state
        for (let i = 0; i < keys.length - 1; i++) {
            const segment = keys[i]
            if (obj[segment] == null || typeof obj[segment] !== 'object') {
                return
            }
            obj = obj[segment]
        }
        delete obj[keys[keys.length - 1]]
        this.store.delete(key)
    }
}

export const getState = (() => {
    let stateInstance: State | null = null
    return (): State => {
        if (!stateInstance) {
            stateInstance = new State()
        }
        return stateInstance
    }
})()
