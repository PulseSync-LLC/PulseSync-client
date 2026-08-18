import { useEffect } from 'react'

import { useNavigate } from 'react-router-dom'

import { useModalContext } from '@app/providers/modal'

const Dev = () => {
    const navigate = useNavigate()
    const { Modals, openModal } = useModalContext()

    useEffect(() => {
        openModal(Modals.SETTINGS)
        void navigate('/home', { replace: true })
    }, [Modals.SETTINGS, navigate, openModal])

    return null
}

export default Dev
