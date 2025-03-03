import React from 'react'
import * as styles from './CustomSlider.module.scss'

interface CustomSliderProps {
    min: number
    max: number
    step: number
    value: number
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

const CustomSlider: React.FC<CustomSliderProps> = ({ min, max, step, value, onChange }) => {
    const percentage = ((value - min) / (max - min)) * 100
    const adjustedPercentage = 1 + ((value - min) / (max - min)) * 97

    return (
        <div className={styles.sliderContainer}>
            <div className={styles.trackContainer}>
                <div className={styles.track}>
                    <div className={styles.filledTrack} style={{ width: `${percentage}%` }}></div>
                    <div className={styles.emptyTrack} style={{ width: `${100 - percentage}%` }}></div>
                    <div className={styles.customThumb} style={{ left: `${adjustedPercentage}%` }}></div>
                </div>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={onChange}
                    className={styles.rangeInput}
                />
            </div>
        </div>
    )
}

export default CustomSlider
