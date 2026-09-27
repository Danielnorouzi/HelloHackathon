// Chart colours. Categorical slots are validated for colour-blind separation on the dark surface
// (dataviz validator: blue / orange / aqua pass all-pairs). Text never uses series colours.
export const COLORS = {
  accent: '#c6ff3d',      // brand accent: the target player (single-series charts)
  blue: '#3987e5',        // series 1: completed pass, shot saved
  orange: '#d95926',      // series 2: incomplete pass, shot off target / blocked
  aqua: '#199e70',        // series 3: goal
  muted: '#8b93a3',
  line: '#272b34',
  pitch: '#101216',
  pitchLine: '#343a46',
}
