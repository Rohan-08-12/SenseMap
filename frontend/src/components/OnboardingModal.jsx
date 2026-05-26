import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { updateSensoryProfile } from '../services/api';
import './OnboardingModal.css';

const STEPS = [
    {
        id: 'noise',
        question: 'How do you feel about noise?',
        hint: 'This helps us show quieter spots first.',
        options: [
            { emoji: '🤫', label: 'Very quiet', value: 1 },
            { emoji: '🎵', label: 'A little noise is fine', value: 3 },
            { emoji: '🔊', label: 'Busy sounds okay', value: 5 },
        ],
    },
    {
        id: 'lighting',
        question: 'What lighting feels comfortable?',
        hint: 'We\'ll prioritise spaces that match your preference.',
        options: [
            { emoji: '🕯️', label: 'Soft & dim', value: 1 },
            { emoji: '🌤️', label: 'Natural light', value: 3 },
            { emoji: '💡', label: 'Bright is fine', value: 5 },
        ],
    },
    {
        id: 'crowd',
        question: 'How about crowd levels?',
        hint: 'We use this to filter out overwhelming places.',
        options: [
            { emoji: '🧘', label: 'Just a few people', value: 1 },
            { emoji: '👥', label: 'Small groups fine', value: 3 },
            { emoji: '🏙️', label: 'Busy is no problem', value: 5 },
        ],
    },
];

const ONBOARDING_KEY = 'sensorymap_onboarding_done';

// eslint-disable-next-line react-refresh/only-export-components
export function hasSeenOnboarding() {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

function OnboardingModal({ onDone }) {
    const [step, setStep] = useState(-1); // -1 = welcome
    const [selections, setSelections] = useState({});
    const [saving, setSaving] = useState(false);

    const currentStep = STEPS[step];
    const isWelcome = step === -1;

    const handleSelect = async (value) => {
        const updated = { ...selections, [currentStep.id]: value };
        setSelections(updated);

        const next = step + 1;
        if (next >= STEPS.length) {
            setSaving(true);
            try {
                await updateSensoryProfile({
                    noiseTolerance: updated.noise ?? 3,
                    lightingTolerance: updated.lighting ?? 3,
                    crowdTolerance: updated.crowd ?? 3,
                });
            } catch {
                // silently continue — profile can be edited later in settings
            }
            setSaving(false);
            localStorage.setItem(ONBOARDING_KEY, 'true');
            onDone();
        } else {
            setStep(next);
        }
    };

    const handleSkip = () => {
        localStorage.setItem(ONBOARDING_KEY, 'true');
        onDone();
    };

    const handleStart = () => setStep(0);

    return (
        <div className="onb-backdrop" role="dialog" aria-modal="true" aria-label="Sensory preferences setup">
            <AnimatePresence mode="wait">
                {isWelcome ? (
                    <motion.div
                        key="welcome"
                        className="onb-panel"
                        initial={{ opacity: 0, y: 24, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -16, scale: 0.97 }}
                        transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                        <div className="onb-welcome-icon" aria-hidden>🗺️</div>
                        <h2 className="onb-welcome-title">Welcome to SenseMap</h2>
                        <p className="onb-welcome-desc">
                            Three quick questions to personalise your experience. No forms — just tap what feels right.
                        </p>
                        <button className="onb-btn-primary" onClick={handleStart}>
                            Let's go
                        </button>
                        <button className="onb-btn-skip" onClick={handleSkip}>
                            Skip for now
                        </button>
                    </motion.div>
                ) : saving ? (
                    <motion.div
                        key="saving"
                        className="onb-panel onb-panel--center"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.25 }}
                    >
                        <div className="onb-saving-icon" aria-hidden>✨</div>
                        <p className="onb-saving-text">Saving your preferences…</p>
                    </motion.div>
                ) : (
                    <motion.div
                        key={`step-${step}`}
                        className="onb-panel"
                        initial={{ opacity: 0, x: 32 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -32 }}
                        transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                        <div className="onb-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                            {STEPS.map((_, i) => (
                                <div key={i} className={`onb-progress-dot${i <= step ? ' active' : ''}`} />
                            ))}
                        </div>

                        <h2 className="onb-question">{currentStep.question}</h2>
                        <p className="onb-hint">{currentStep.hint}</p>

                        <div className="onb-options">
                            {currentStep.options.map((opt) => (
                                <button
                                    key={opt.value}
                                    className="onb-option"
                                    onClick={() => handleSelect(opt.value)}
                                >
                                    <span className="onb-option-emoji" aria-hidden>{opt.emoji}</span>
                                    <span className="onb-option-label">{opt.label}</span>
                                </button>
                            ))}
                        </div>

                        <button className="onb-btn-skip" onClick={handleSkip}>
                            Skip setup
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default OnboardingModal;
