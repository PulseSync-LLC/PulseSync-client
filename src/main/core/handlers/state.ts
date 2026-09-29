export let state: {
    lastWindowBlurredOrHiddenTime: number
    deeplink: string | null
    willQuit: boolean
}
state = {
    willQuit: false,
    lastWindowBlurredOrHiddenTime: 0,
    deeplink: null,
}
