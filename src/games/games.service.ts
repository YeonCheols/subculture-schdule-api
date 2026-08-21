import { Injectable } from '@nestjs/common';
import { GAME_CATALOG_ITEMS, GAME_CATALOG_UPDATED_AT, type GamesResponse } from './game-catalog';

@Injectable()
export class GamesService {
  findAll(): GamesResponse {
    return {
      // Return new item objects so response serialization cannot mutate catalog state.
      items: GAME_CATALOG_ITEMS.map((item) => ({ ...item, icon: item.icon ? { ...item.icon } : null })),
      updatedAt: GAME_CATALOG_UPDATED_AT,
    };
  }
}
