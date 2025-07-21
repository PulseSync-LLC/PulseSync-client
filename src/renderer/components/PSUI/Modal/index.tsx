import React from 'react'
import RModal from 'react-modal'
import Button from '../../buttonV2'
import { IoCloseSharp } from 'react-icons/io5'
import './modal.css'
interface p {
    title?: string
    isOpen: boolean
    reqClose: () => void
    children: any
    size?: any[]
    styles?: React.CSSProperties
}

const Modal: React.FC<p> = ({ title, isOpen, reqClose, children }) => {
    return (
        <RModal isOpen={isOpen} onRequestClose={reqClose} className="modal-content" overlayClassName="modal-overlay" closeTimeoutMS={500}>
            <div className="modal-header">
                <h2>{title}</h2>
                <Button className="close-button" onClick={reqClose}>
                    <IoCloseSharp size={20} style={{ color: 'var(--white)' }} />
                </Button>
            </div>
            {children}
        </RModal>
    )
}

export default Modal
