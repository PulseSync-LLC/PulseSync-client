// src/pages/extension/TagFilterPanel.tsx
import React from 'react'
import * as extensionStyles from './../../../../renderer/pages/extension/extension.module.scss'

interface TagFilterPanelProps {
    allTags: string[]
    selectedTags: Set<string>
    toggleTag: (tag: string) => void
}

export default function TagFilterPanel({ allTags, selectedTags, toggleTag }: TagFilterPanelProps) {
    return (
        <div className={extensionStyles.tagFilterPane}>
            {allTags.map(tag => (
                <label key={tag} className={extensionStyles.filterCheckbox}>
                    <input type="checkbox" checked={selectedTags.has(tag)} onChange={() => toggleTag(tag)} />
                    {tag}
                </label>
            ))}
        </div>
    )
}
