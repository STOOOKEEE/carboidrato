// Les taux XLS-66 sont exprimés en dixièmes de point de base : 1 % = 1 000.

export const TENTH_BIPS_PER_PERCENT = 1_000;
const MAX_PERCENT = 100;

export function percentToTenthBips(percent: number): number {
  const value = Math.round(percent * TENTH_BIPS_PER_PERCENT);
  if (value < 0 || value > MAX_PERCENT * TENTH_BIPS_PER_PERCENT) {
    throw new Error(`Taux hors bornes : ${percent} %`);
  }
  return value;
}
