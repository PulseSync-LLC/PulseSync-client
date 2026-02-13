import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface ModalState {
    isOpen: boolean
    modalContent: string | null
    linuxAsarOpen: boolean
    linuxAsarPath: string | null
    premiumPromoModalOpen: boolean
}

const initialState: ModalState = {
    isOpen: false,
    modalContent: null,
    linuxAsarOpen: false,
    linuxAsarPath: null,
    premiumPromoModalOpen: false,
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
        openPremiumPromoModal: state => {
            state.premiumPromoModalOpen = true
        },
        closePremiumPromoModal: state => {
            state.premiumPromoModalOpen = false
        },
        setLinuxAsarPath: (state, action: PayloadAction<string | null>) => {
            state.linuxAsarPath = action.payload
        },
    },
})

export const { openModal, closeModal, openLinuxAsarModal, closeLinuxAsarModal, setLinuxAsarPath, closePremiumPromoModal, openPremiumPromoModal } = modalSlice.actions
export default modalSlice.reducer
