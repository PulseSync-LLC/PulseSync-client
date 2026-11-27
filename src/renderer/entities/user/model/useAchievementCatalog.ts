import { useEffect, useState } from 'react'

import GetAchievementsQuery from '@entities/user/api/getAchievements.query'
import apolloClient from '@shared/api/apolloClient'

type AchievementCatalogItem = {
    id: string
    title: string
    description: string
    imageUrl: string
    progressTotal: number
    points: number
    difficulty: string
    hint: string
}

type GetAchievementsData = {
    getAchievements?: {
        achievements?: AchievementCatalogItem[]
        totalPages?: number
    } | null
}

export function useAchievementCatalog(userId: string, revision: number) {
    const [achievements, setAchievements] = useState<AchievementCatalogItem[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const controller = new AbortController()
        setAchievements([])
        setLoading(userId !== '-1')
        if (userId === '-1') return () => controller.abort()

        void (async () => {
            try {
                const items = new Map<string, AchievementCatalogItem>()
                let totalPages = 1
                for (let page = 1; page <= totalPages; page++) {
                    const result = await apolloClient.query<GetAchievementsData>({
                        query: GetAchievementsQuery,
                        variables: { page, pageSize: 100, search: '', sortOptions: [] },
                        fetchPolicy: 'no-cache',
                        context: { queryDeduplication: false, fetchOptions: { signal: controller.signal } },
                    })
                    if (controller.signal.aborted) return
                    if (page === 1) totalPages = Math.max(1, Number(result.data?.getAchievements?.totalPages || 1))
                    for (const item of result.data?.getAchievements?.achievements ?? []) items.set(item.id, item)
                }
                setAchievements([...items.values()])
            } catch (error) {
                if (!controller.signal.aborted) console.error('Failed to fetch achievements:', error)
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        })()

        return () => controller.abort()
    }, [userId, revision])

    return { achievements, loading }
}
