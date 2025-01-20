import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface AppState {
    isDeprecated: boolean
    version: string | null
}

const initialState: AppState = {
    isDeprecated: false,
    version: null,
}

const appSlice = createSlice({
    name: 'app',
    initialState,
    reducers: {
        setDeprecatedStatus: (state, action: PayloadAction<boolean>) => {
            state.isDeprecated = action.payload
        },
        setVersion: (state, action: PayloadAction<string>) => {
            state.version = action.payload
        },
    },
})

export const { setDeprecatedStatus, setVersion } = appSlice.actions
export default appSlice.reducer
