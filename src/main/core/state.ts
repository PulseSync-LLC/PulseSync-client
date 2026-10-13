import logger from '../shared/logger'
import isAppDev from '../shared/utils/isAppDev'
import { getStore } from './storage'

import type { StoreType } from './storage'

class State {
    private readonly store: StoreType

    constructor() {
        this.store = getStore()
        if (isAppDev) {
            const snapshot = this.store.getAll()
            logger.main.debug('State initialized with:', {
                ...snapshot,
                tokens: snapshot.tokens ? { ...snapshot.tokens, token: '[redacted]' } : undefined,
            })
        } else {
            logger.main.info('State initialized')
        }
    }

    public get(key: string): any {
        return this.store.get(key)
    }

    public set(key: string, value: any): void {
        this.store.set(key, value)
    }

    public delete(key: string): void {
        this.store.delete(key)
    }
}

const STATE_KEY = Symbol.for('pulsesync.main.state')
const stateRuntime = globalThis as typeof globalThis & { [STATE_KEY]?: State }

export const getState = (): State => {
    stateRuntime[STATE_KEY] ??= new State()
    return stateRuntime[STATE_KEY]
}
