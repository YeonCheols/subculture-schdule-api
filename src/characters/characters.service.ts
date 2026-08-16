import { Injectable } from '@nestjs/common';
import type { GameCharacter } from '../domain/character';
import { StorageService } from '../storage/storage.service';

const PATH = 'schedule-api/characters.json';

@Injectable()
export class CharactersService {
  constructor(private readonly storage: StorageService) {}
  async findAll(query: { gameId?: string }): Promise<GameCharacter[]> {
    const characters = await this.storage.readJson<GameCharacter[]>(PATH);
    return characters.filter((character) => !query.gameId || character.gameId === query.gameId);
  }
  async import(characters: GameCharacter[]) {
    await this.storage.writeJson(PATH, characters);
    return { characterCount: characters.length };
  }
}
