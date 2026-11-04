import gql from 'graphql-tag'

export default gql`
    query GetSubscriptionGiveawaysSnapshot {
        getSubscriptionGiveaways {
            uuid
            title
            description
            planCode
            durationMonths
            winnersCount
            status
            startsAt
            endsAt
        }
        getEnteredSubscriptionGiveawayIds
    }
`
