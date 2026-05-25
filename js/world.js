// Parses the raw level JSON into a compact runtime world structure.
// Tile rows are strings of single characters; here we expose them as
// 2D arrays of integers for the renderer to consume.

export function buildWorld(raw) {
  const biomeRows = raw.biome_tiles.tiles.map(parseRow);
  const constructionRows = raw.construction_tiles.tiles.map(parseRow);

  return {
    id: raw.id,
    rows: biomeRows.length,
    cols: biomeRows[0]?.length ?? 0,
    biomeSheetId: raw.biome_tiles.sheet_id,
    constructionSheetId: raw.construction_tiles.sheet_id,
    biome: biomeRows,
    construction: constructionRows,
    entities: raw.entities ?? [],
  };
}

function parseRow(row) {
  const out = new Array(row.length);
  for (let i = 0; i < row.length; i++) out[i] = parseInt(row[i], 16);
  return out;
}
