type UiReadyTask = () => void

let uiReady = false
const pendingUiReadyTasks: UiReadyTask[] = []

export const isUiReady = (): boolean => uiReady

export const runWhenUiReady = (task: UiReadyTask): void => {
    if (uiReady) {
        task()
        return
    }

    pendingUiReadyTasks.push(task)
}

export const markUiReady = (): void => {
    if (uiReady) return

    uiReady = true
    const tasks = pendingUiReadyTasks.splice(0, pendingUiReadyTasks.length)
    for (const task of tasks) {
        try {
            task()
        } catch (error) {
            console.error('Failed to run pending UI-ready task:', error)
        }
    }
}
