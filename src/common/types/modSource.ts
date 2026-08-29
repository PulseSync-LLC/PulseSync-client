export type ModReleaseChannel = 'stable' | 'branch'

export type ModSourceSelection =
    | {
          branch: ''
          type: 'stable'
      }
    | {
          branch: string
          type: 'branch'
      }

export interface ModBranchBuildSummary {
    branch: string
    builtAt: string
    commit: string
    version: string
    yandexMusicVersion: string
}

export interface ModSourceCatalog {
    branches: ModBranchBuildSummary[]
    selected: ModSourceSelection
}

export const STABLE_MOD_SOURCE: ModSourceSelection = {
    branch: '',
    type: 'stable',
}
