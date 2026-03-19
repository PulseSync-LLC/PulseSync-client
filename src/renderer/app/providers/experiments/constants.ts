export const CLIENT_EXPERIMENTS = {
    ClientAchievements: 'ClientAchievements',
    WebLocalizationContribution: 'WebLocalizationContribution',
    WebHomeSections: 'WebHomeSections',
} as const

export const KNOWN_CLIENT_EXPERIMENT_KEYS = Object.values(CLIENT_EXPERIMENTS)

export type KnownClientExperimentKey = (typeof CLIENT_EXPERIMENTS)[keyof typeof CLIENT_EXPERIMENTS]

// Keep support for backend-driven experiments that are not yet added to the local constants map.
export type ClientExperimentKey = KnownClientExperimentKey | (string & {})

export function isKnownClientExperimentKey(key: string): key is KnownClientExperimentKey {
    return KNOWN_CLIENT_EXPERIMENT_KEYS.includes(key as KnownClientExperimentKey)
}
