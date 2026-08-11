import type { DesktopAddonOrganization, DesktopAddonOrganizationCategory } from '@common/desktopApi/contract'

export const EMPTY_ADDON_ORGANIZATION: DesktopAddonOrganization = {
    version: 1,
    favoriteAddonIds: [],
    categories: [],
    categoryByAddonId: {},
}

const readRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const readId = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const readCategoryName = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 80) : '')

export function normalizeAddonOrganization(value: unknown): DesktopAddonOrganization {
    const source = readRecord(value)
    if (!source) return EMPTY_ADDON_ORGANIZATION

    const favoriteAddonIds = Array.from(
        new Set((Array.isArray(source.favoriteAddonIds) ? source.favoriteAddonIds : []).map(readId).filter(Boolean)),
    )
    const seenCategoryIds = new Set<string>()
    const categories: DesktopAddonOrganizationCategory[] = []

    for (const candidate of Array.isArray(source.categories) ? source.categories : []) {
        const record = readRecord(candidate)
        const id = readId(record?.id)
        const name = readCategoryName(record?.name)
        if (!id || !name || seenCategoryIds.has(id)) continue
        seenCategoryIds.add(id)
        categories.push({ id, name })
    }

    const categoryByAddonId: Record<string, string> = {}
    const rawAssignments = readRecord(source.categoryByAddonId)
    if (rawAssignments) {
        for (const [rawAddonId, rawCategoryId] of Object.entries(rawAssignments)) {
            const addonId = readId(rawAddonId)
            const categoryId = readId(rawCategoryId)
            if (addonId && seenCategoryIds.has(categoryId)) {
                categoryByAddonId[addonId] = categoryId
            }
        }
    }

    return {
        version: 1,
        favoriteAddonIds,
        categories,
        categoryByAddonId,
    }
}

export function setAddonFavorite(organization: DesktopAddonOrganization, addonId: string, favorite: boolean): DesktopAddonOrganization {
    const normalizedId = readId(addonId)
    if (!normalizedId) return organization

    const favoriteIds = new Set(organization.favoriteAddonIds)
    if (favorite) favoriteIds.add(normalizedId)
    else favoriteIds.delete(normalizedId)

    return { ...organization, favoriteAddonIds: Array.from(favoriteIds) }
}

export function createAddonCategory(organization: DesktopAddonOrganization, name: string): DesktopAddonOrganization {
    const normalizedName = readCategoryName(name)
    if (!normalizedName || organization.categories.some(category => category.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
        return organization
    }

    const categoryId = globalThis.crypto?.randomUUID?.() ?? `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    return {
        ...organization,
        categories: [...organization.categories, { id: categoryId, name: normalizedName }],
    }
}

export function assignAddonCategory(
    organization: DesktopAddonOrganization,
    addonId: string,
    categoryId: string | null,
): DesktopAddonOrganization {
    const normalizedAddonId = readId(addonId)
    const normalizedCategoryId = readId(categoryId)
    if (!normalizedAddonId) return organization
    if (normalizedCategoryId && !organization.categories.some(category => category.id === normalizedCategoryId)) return organization

    const categoryByAddonId = { ...organization.categoryByAddonId }
    if (normalizedCategoryId) categoryByAddonId[normalizedAddonId] = normalizedCategoryId
    else delete categoryByAddonId[normalizedAddonId]

    return { ...organization, categoryByAddonId }
}

export function deleteAddonCategory(organization: DesktopAddonOrganization, categoryId: string): DesktopAddonOrganization {
    const normalizedCategoryId = readId(categoryId)
    if (!normalizedCategoryId || !organization.categories.some(category => category.id === normalizedCategoryId)) return organization

    return {
        ...organization,
        categories: organization.categories.filter(category => category.id !== normalizedCategoryId),
        categoryByAddonId: Object.fromEntries(
            Object.entries(organization.categoryByAddonId).filter(([, assignedCategoryId]) => assignedCategoryId !== normalizedCategoryId),
        ),
    }
}
