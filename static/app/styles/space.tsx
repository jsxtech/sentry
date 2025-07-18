const SPACES = {
  0.25: '2px',
  0.5: '4px',
  0.75: '6px',
  1: '8px',
  1.5: '12px',
  2: '16px',
  3: '20px',
  4: '30px',
} as const;

export type ValidSize = keyof typeof SPACES;

/**
 * @deprecated prefer using `theme.space`
 */
function space<S extends ValidSize>(size: S): (typeof SPACES)[S] {
  return SPACES[size];
}

export {space};
