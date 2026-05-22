import { PUBLICATION_CHANGELOG_TAB, RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import type { ActiveTab, DocTab } from '@pages/extension/route/extBox/types'

interface SelectDefaultExtensionTabOptions {
    docs: DocTab[]
    hasPublicationChangelog?: boolean
    shouldOpenRelationsByDefault?: boolean
}

const getDocTabValue = (doc: DocTab): ActiveTab => doc.value || doc.title

export const selectDefaultExtensionTab = ({
    docs,
    hasPublicationChangelog = false,
    shouldOpenRelationsByDefault = false,
}: SelectDefaultExtensionTabOptions): ActiveTab => {
    if (shouldOpenRelationsByDefault) {
        return RELATIONS_TAB
    }

    const readmeTab = docs.find(doc => getDocTabValue(doc) === 'README')
    if (readmeTab) {
        return getDocTabValue(readmeTab)
    }

    const changelogTab = docs.find(doc => getDocTabValue(doc) === 'Changelog')
    if (changelogTab) {
        return getDocTabValue(changelogTab)
    }

    if (hasPublicationChangelog) {
        return PUBLICATION_CHANGELOG_TAB
    }

    if (docs.length) {
        return getDocTabValue(docs[0])
    }

    return 'Settings'
}
