// UI words that depend on the project's building type (manifest.buildingType) — the engine does not assume the building is a house.
import { t } from '../../i18n';
import { derived, hasModule } from '../../project/active';

export interface BuildingWords {
  /** nominative: "house" / "apartment" */
  noun: string;
  /** genitive form (languages with cases); in English the same as the noun */
  gen: string;
  /** "My house" / "My apartment", "Your house" / "Your apartment" */
  my: string;
  your: string;
  /** walk scope: "around the house and plot" / "around the apartment" */
  walk: string;
}

export const buildingWords = derived((p): BuildingWords => {
  const apartment = p.manifest.buildingType === 'apartment', site = hasModule('site');
  return apartment
    ? { noun: t('wording.apartment.noun'), gen: t('wording.apartment.gen'), my: t('wording.apartment.my'), your: t('wording.apartment.your'), walk: t('wording.apartment.walk') }
    : { noun: t('wording.house.noun'), gen: t('wording.house.gen'), my: t('wording.house.my'), your: t('wording.house.your'), walk: site ? t('wording.house.walkSite') : t('wording.house.walk') };
});
