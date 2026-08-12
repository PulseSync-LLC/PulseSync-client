import { DESCRIPTION_TAB, RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import type { ActiveTab, DocTab } from '@pages/extension/route/extBox/types'

interface SelectDefaultExtensionTabOptions {
    docs: DocTab[]
    hasPublicationChangelog?: boolean
    shouldOpenRelationsByDefault?: boolean
}

export const selectDefaultExtensionTab = ({ shouldOpenRelationsByDefault = false }: SelectDefaultExtensionTabOptions): ActiveTab => {
    if (shouldOpenRelationsByDefault) {
        return RELATIONS_TAB
    }

    return DESCRIPTION_TAB
}
