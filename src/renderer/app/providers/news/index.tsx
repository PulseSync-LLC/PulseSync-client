import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useQuery } from '@apollo/client/react'
import GET_VISIBLE_NEWS from '@entities/news/api/getVisibleNews.query'
import type { GetVisibleNewsData, NewsContextValue, NewsProviderProps } from '@app/providers/news/types'

const noopAsync = async (): Promise<void> => undefined

const defaultNewsContextValue: NewsContextValue = {
    news: [],
    loading: false,
    error: null,
    refresh: noopAsync,
}

export const NewsContext = createContext<NewsContextValue>(defaultNewsContextValue)

export function NewsProvider({ children, enabled = true }: NewsProviderProps) {
    const { data, loading, error, refetch } = useQuery<GetVisibleNewsData>(GET_VISIBLE_NEWS, {
        skip: !enabled,
        fetchPolicy: 'cache-first',
        nextFetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
    })

    useEffect(() => {
        if (!error) {
            return
        }

        console.error('[NewsProvider] failed to fetch visible news:', error)
    }, [error])

    const refresh = useCallback(async () => {
        if (!enabled) {
            return
        }

        await refetch()
    }, [enabled, refetch])

    const value = useMemo<NewsContextValue>(
        () => ({
            news: enabled ? (data?.getVisibleNews ?? []) : [],
            loading: enabled ? loading : false,
            error: error ?? null,
            refresh,
        }),
        [data?.getVisibleNews, enabled, error, loading, refresh],
    )

    return <NewsContext.Provider value={value}>{children}</NewsContext.Provider>
}

export function useNews() {
    return useContext(NewsContext)
}
