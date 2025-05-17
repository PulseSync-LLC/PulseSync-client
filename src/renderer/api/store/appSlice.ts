import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface AppState {
    isAppDeprecated: boolean
    appVersion: string | null
}

const initialState: AppState = {
    isAppDeprecated: false,
    appVersion: null,
}

const appSlice = createSlice({
    name: 'app',
    initialState,
    reducers: {
        setAppDeprecatedStatus: (state, action: PayloadAction<boolean>) => {
            state.isAppDeprecated = action.payload
        },
        setAppVersion: (state, action: PayloadAction<string>) => {
            state.appVersion = action.payload
        },
    },
})

export const { setAppDeprecatedStatus, setAppVersion } = appSlice.actions
export default appSlice.reducer
