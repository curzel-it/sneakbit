// Node-side data loader for the autoplay analysis modules. js/autoplay/*
// stays environment-agnostic (data in, plain values out); this is the one
// place that touches the filesystem. Mirrors what js/data.js does with
// fetch() in the browser, synchronously and from disk.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSpeciesData } from "../js/species.js";
import { loadStringsData } from "../js/strings.js";

const DEFAULT_DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

// Loads species + strings into their registries (required before any
// analysis touches getSpecies / tr) and returns a synchronous zone loader:
// (id) => raw zone JSON, or null when no such zone file exists.
export function loadWorldFromDisk(dataDir = DEFAULT_DATA_DIR) {
  loadSpeciesData(JSON.parse(readFileSync(`${dataDir}species.json`, "utf8")));
  loadStringsData(JSON.parse(readFileSync(`${dataDir}strings.en.json`, "utf8")));
  const loadRawZone = (id) => {
    try {
      return JSON.parse(readFileSync(`${dataDir}${id}.json`, "utf8"));
    } catch {
      return null;
    }
  };
  return { loadRawZone, dataDir };
}
