import type NewsInterface from '@entities/news/model/news.interface'
import type { ReactNode } from 'react'

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
