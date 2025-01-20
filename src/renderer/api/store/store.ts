import { configureStore } from '@reduxjs/toolkit'
import modalReducer from './modalSlice'
import appReducer from './appSlice'

const store = configureStore({
    reducer: {
        modal: modalReducer,
        app: appReducer,
    },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
