import type { ReactNode } from 'react'
import type NewsInterface from '@entities/news/model/news.interface'

export type GetVisibleNewsData = {
    getVisibleNews?: NewsInterface[] | null
}

export type NewsContextValue = {
    news: NewsInterface[]
    loading: boolean
    error: Error | null
    refresh: () => Promise<void>
}

export type NewsProviderProps = {
    children: ReactNode
    enabled?: boolean
}
