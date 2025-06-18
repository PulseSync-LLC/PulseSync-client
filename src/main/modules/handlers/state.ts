export let state: {
    lastWindowBlurredOrHiddenTime: number
    deeplink: string
    willQuit: boolean
}
state = {
    willQuit: false,
    lastWindowBlurredOrHiddenTime: 0,
    deeplink: null,
}
