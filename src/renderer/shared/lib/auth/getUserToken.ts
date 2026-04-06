const getUserToken = () => {
    if (typeof window !== 'undefined') {
        return window.electron.store.get('tokens.token')
    }

    return ''
}

export default getUserToken
