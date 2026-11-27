import { createContext, useContext } from 'react'

import type { SocketContextValue } from './types'

const SocketContext = createContext<SocketContextValue>({ socketConnected: false, emitGateway: () => {} })

export const useSocketContext = () => useContext(SocketContext)
export default SocketContext
