import toast, { Renderable, ToastOptions } from 'react-hot-toast'

const style = {
    background: '#292C36',
    color: '#ffffff',
    border: 'solid 1px #363944',
    borderRadius: '8px',
    zIndex: 999999,
}

const iToast = {
    success: (message: Renderable, options?: any) =>
        createToast('success', message, options),
    error: (message: Renderable, options?: any) =>
        createToast('error', message, options),
    custom: (message: Renderable, options?: any) =>
        createToast('custom', message, options),
    loading: (message: Renderable, options?: any) =>
        createToast('loading', message, options),
}

function createToast(
    type: 'success' | 'error' | 'loading' | 'custom',
    message: Renderable,
    options?: ToastOptions,
) {
    toast[type](message, {
        ...options,
        style,
    })
}

export default iToast
