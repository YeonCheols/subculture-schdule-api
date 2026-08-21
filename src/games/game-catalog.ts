import type { GameId } from '../domain/event';

export interface GameIcon {
  url: string;
  version: string;
}

export interface GameCatalogItem {
  id: GameId;
  name: string;
  shortName: string;
  enabled: boolean;
  sortOrder: number;
  icon: GameIcon | null;
}

export interface GamesResponse {
  items: GameCatalogItem[];
  updatedAt: string;
}

// Update this timestamp whenever catalog metadata changes. Icon URLs remain null
// until a verified, publisher-provided asset is available for public hosting.
export const GAME_CATALOG_UPDATED_AT = '2026-08-21T09:00:00+09:00';

export const GAME_CATALOG_ITEMS: readonly GameCatalogItem[] = [
  { id: 'monster', name: '몬길: STAR DIVE', shortName: '몬길: STAR DIVE', enabled: true, sortOrder: 10, icon: null },
  { id: 'wuthering', name: '명조: 워더링 웨이브', shortName: '명조', enabled: true, sortOrder: 20, icon: null },
  { id: 'genshin', name: '원신', shortName: '원신', enabled: true, sortOrder: 30, icon: null },
  { id: 'nte', name: '이환', shortName: '이환', enabled: true, sortOrder: 40, icon: null },
];
