import { ApolloClient, InMemoryCache, ApolloLink, HttpLink } from '@apollo/client'
import { getMainDefinition } from '@apollo/client/utilities'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { setContext } from '@apollo/client/link/context'
import { createClient } from 'graphql-ws'
import config from '@common/appConfig'
import { getUserTokenAsync } from '@shared/lib/auth/getUserToken'

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
              }),
          )
        : null

const authMiddleware = setContext(async (_, { headers }) => {
    const token = await getUserTokenAsync()
    return {
        headers: {
            ...headers,
            Authorization: token ? `Bearer ${token}` : null,
        },
    }
})

const splitLink = wsLink
    ? ApolloLink.split(
          ({ query }) => {
              const def = getMainDefinition(query)
              return def.kind === 'OperationDefinition' && def.operation === 'subscription'
          },
          wsLink,
          ApolloLink.from([authMiddleware, httpLink]),
      )
    : ApolloLink.from([authMiddleware, httpLink])

const client = new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache({
        resultCaching: true,
    }),
})

export default client
