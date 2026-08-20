import { SKILL_CATALOG } from "../domain/catalog.ts";
import type { SkillCategory, SkillDefinition } from "../domain/types.ts";
import type { CatalogSeedResult, SkillCatalogPort } from "../ports.ts";

export async function seedSkillCatalog(
  deps: { catalog: Pick<SkillCatalogPort, "sync"> },
): Promise<CatalogSeedResult> {
  return deps.catalog.sync(SKILL_CATALOG);
}

export async function listSkillCatalog(
  category: SkillCategory | undefined,
  deps: { catalog: Pick<SkillCatalogPort, "all"> },
): Promise<SkillDefinition[]> {
  const catalog = await deps.catalog.all();
  return category ? catalog.filter((entry) => entry.category === category) : catalog;
}
