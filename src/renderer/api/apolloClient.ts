import {
    ApolloClient,
    InMemoryCache,
    ApolloLink,
    HttpLink,
    split,
    concat,
} from '@apollo/client'
import { getMainDefinition } from '@apollo/client/utilities'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { createClient } from 'graphql-ws'
import config from './config'

const httpUrl = config.SERVER_URL + '/graphql'
const wsUrl = config.SERVER_URL.replace(/^http/, 'ws') + '/graphql'

const httpLink = new HttpLink({ uri: httpUrl })

const wsLink =
    typeof window !== 'undefined'
        ? new GraphQLWsLink(
            createClient({
                url: wsUrl,
                retryAttempts: Infinity,
                shouldRetry: () => true,
            })
        )
        : null

const authMiddleware = new ApolloLink((operation, forward) => {
    const token = window.electron.store.get('tokens.token')
    operation.setContext({
        headers: {
            Authorization: token ? `Bearer ${token}` : null,
        },
    })
    return forward(operation)
})

const splitLink = wsLink
    ? split(
        ({ query }) => {
            const def = getMainDefinition(query)
            return (
                def.kind === 'OperationDefinition' &&
                def.operation === 'subscription'
            )
        },
        wsLink,
        concat(authMiddleware, httpLink)
    )
    : concat(authMiddleware, httpLink)

const client = new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache({
        resultCaching: true,
    }),
    ssrMode: true,
})

export default client
