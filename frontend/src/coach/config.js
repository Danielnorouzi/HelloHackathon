// Live Skills Coach thresholds and cue wording. The same JSON file drives the server-side session
// summary (backend/app/coach/rules.py), so live cues and the summary always agree.
import rules from '../../../backend/config/coach_rules.json'

export const RULES = rules
export const skillRules = (skill) => rules.skills[skill]
export const SKILLS = Object.keys(rules.skills)
