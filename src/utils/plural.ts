/** "1 kit", "0 kits", "2 kits": a count and its noun, singular only for exactly 1. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
