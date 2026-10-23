import { CombinedGraphQLErrors, ServerError } from '@apollo/client'

import apolloClient from '@shared/api/apolloClient'

import GetAllUsersQuery, { GetUsersFirstPageQuery, GetUsersNextPageQuery } from './getAllUsers.query'

import type UserInterface from '../model/user.interface'

type UsersPagePayload = {
    users: UserInterface[]
    totalPages?: number
    hasMore?: boolean
    endCursor?: string | null
}

type UsersPageData = {
    getUsersWithPagination?: UsersPagePayload | null
}

type UsersPageOptions = {
    page: number
    perPage: number
    sorting: { id: string; desc: boolean }[]
    search: string
    after?: string | null
    includeTotalPages: boolean
    legacy: boolean
}

function isUnsupportedPagination(error: unknown): boolean {
    let messages: string[]
    if (CombinedGraphQLErrors.is(error)) {
        messages = error.errors.map(item => item.message)
    } else if (ServerError.is(error) && error.statusCode === 400) {
        try {
            const body = JSON.parse(error.bodyText)
            if (!Array.isArray(body.errors)) return false
            messages = body.errors.map((item: { message?: unknown }) => (typeof item?.message === 'string' ? item.message : ''))
        } catch {
            return false
        }
    } else {
        return false
    }

    return (
        messages.length > 0 &&
        messages.every(message =>
            /Cannot query field "(?:hasMore|endCursor)" on type "GetUsersWithPaginationPayload"|Unknown argument "after" on field "Query\.getUsersWithPagination"/.test(
                message,
            ),
        )
    )
}

export async function getUsersPage(options: UsersPageOptions): Promise<{ payload: UsersPagePayload | null; legacy: boolean }> {
    const variables = { page: options.page, perPage: options.perPage, sorting: options.sorting, search: options.search }
    if (!options.legacy) {
        try {
            const result = await apolloClient.query<UsersPageData>({
                query: options.includeTotalPages ? GetUsersFirstPageQuery : GetUsersNextPageQuery,
                variables: { ...variables, page: options.after ? 1 : options.page, after: options.after ?? null },
                fetchPolicy: 'no-cache',
            })
            return { payload: result.data?.getUsersWithPagination ?? null, legacy: false }
        } catch (error) {
            if (!isUnsupportedPagination(error)) throw error
        }
    }

    const result = await apolloClient.query<UsersPageData>({ query: GetAllUsersQuery, variables, fetchPolicy: 'no-cache' })
    return { payload: result.data?.getUsersWithPagination ?? null, legacy: true }
}
