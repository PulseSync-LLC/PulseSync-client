import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface ModalState {
    isOpen: boolean
    modalContent: string | null
    linuxAsarOpen: boolean
    linuxAsarPath: string | null
}

const initialState: ModalState = {
    isOpen: false,
    modalContent: null,
    linuxAsarOpen: false,
    linuxAsarPath: null,
}

const modalSlice = createSlice({
    name: 'modal',
    initialState,
    reducers: {
        openModal: (state, action: PayloadAction<string>) => {
            state.isOpen = true
            state.modalContent = action.payload
        },
        closeModal: state => {
            state.isOpen = false
            state.modalContent = null
        },
        openLinuxAsarModal: state => {
            state.linuxAsarOpen = true
        },
        closeLinuxAsarModal: state => {
            state.linuxAsarOpen = false
        },
        setLinuxAsarPath: (state, action: PayloadAction<string | null>) => {
            state.linuxAsarPath = action.payload
        },
    },
})

export const { openModal, closeModal, openLinuxAsarModal, closeLinuxAsarModal, setLinuxAsarPath } = modalSlice.actions
export default modalSlice.reducer
