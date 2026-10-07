type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };

/** Flattens an object the way jQuery.param does, which is what the portal's PHP backend expects. */
export const toForm = (obj: Record<string, Value>): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (prefix: string, value: Value): void => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    else out[prefix] = value == null ? '' : String(value);
  };
  for (const [k, v] of Object.entries(obj)) walk(k, v);
  return out;
};
