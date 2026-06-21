import { SearchIndex, SearchHit } from "./search-index";

export function searchNotes(index: SearchIndex, query: string): SearchHit[] {
  return index.search(query);
}
