import { readdir } from "fs/promises";

const BASE_URL = "https://www.cardmarket.com/en/Pokemon/Products/Singles/";
const CARD_SETS_DIR = "./card-sets";
const CHECKED_FILE = "./checked-cards.json";
const VARIANTS_FILE = "./variants-found.json";

type CheckedCards = Record<string, { status: "ok" | "no-variants" | "error"; variants: string[] }>;

// ---- Utilities ----

// Load JSON file or return default
async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T;
  } catch {
    return fallback;
  }
}

// Save JSON with indentation
async function saveJson(path: string, data: any) {
  await Bun.write(path, JSON.stringify(data, null, 2));
}

// Save variants (only those with results)
async function saveVariants(data: CheckedCards) {
  const variants = Object.entries(data)
    .filter(([_, v]) => v.variants.length > 0)
    .map(([card, v]) => ({ card, variants: v.variants }));
  await saveJson(VARIANTS_FILE, variants);
}

// Delay utility
const delay = (ms = 3000) => new Promise((res) => setTimeout(res, ms));

// Check if a page exists
async function isDirectPage(url: string): Promise<boolean> {
  while (true) {
    const res = await fetch(url, { 
      method: "HEAD", // Use HEAD to reduce data transfer
      redirect: "manual" // Don't follow redirects
    });

    if (res.status === 429) {
      console.warn("⚠️ 429 Too Many Requests - waiting 60s...");
      await delay(60000);
      continue;
    }
    if (res.status === 403) {
      console.warn("⛔ 403 Forbidden - waiting 5min...");
      await delay(300000);
      continue;
    }

    // check if got redirected
    if (res.url !== url) return false;

    const html = await res.text();
    if (html.includes("Invalid product!")) {
      return false;
    }

    return res.status === 200;
  }
}

// Load all cards from JSON files
async function loadAllCards(): Promise<{ set: string; code: string; cards: string[] }[]> {
  const files = await readdir(CARD_SETS_DIR);
  const sets: { set: string; code: string; cards: string[] }[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const json = await Bun.file(`${CARD_SETS_DIR}/${file}`).json() as {
      set: string;
      code: string;
      cards: string[];
    };

    // Format cards into slugs
    const formattedCards = json.cards.map((line) => {
      const [number, ...nameParts] = line.split(/\s+/);
      const cardNumber = number.padStart(3, "0");
      const rawName = nameParts.join("-");
      const cleanedName = rawName
        .replace(/[()\[\]']/g, "");
      return `${cleanedName}-${json.code}${cardNumber}`;
    });

    sets.push({ set: json.set, code: json.code, cards: formattedCards });
  }
  return sets;
}

// ---- Main logic ----
async function scanCards(updateOnlyErrors = false) {
  const allSets = await loadAllCards();
  const checked = await loadJson<CheckedCards>(CHECKED_FILE, {});

  for (const { set, cards } of allSets) {
    for (const card of cards) {
      const already = checked[card];
      if (already && (!updateOnlyErrors || already.status !== "error")) continue;

      console.log(`🔍 Checking ${card}...`);
      const slugV1 = `${BASE_URL}${set}/${card.replace(/-(\w+\d{3})$/, "-V1-$1")}`;

      try {
        const hasV1 = await isDirectPage(slugV1);
        if (!hasV1) {
          checked[card] = { status: "no-variants", variants: [] };
          console.log(`❌ No variants for ${card}`);
        } else {
          const variants: string[] = [slugV1];
          for (let i = 2; i <= 5; i++) {
            await delay();
            const slugVi = slugV1.replace("-V1-", `-V${i}-`);
            if (await isDirectPage(slugVi)) {
              variants.push(slugVi);
              console.log(`✅ Variant found: ${slugVi}`);
            }
          }
          checked[card] = { status: "ok", variants };
        }
      } catch (err) {
        console.error(`⚠️ Error loading ${card}`, err);
        checked[card] = { status: "error", variants: [] };
      }

      await saveJson(CHECKED_FILE, checked);
      await saveVariants(checked);
      await delay();
    }
  }
  console.log("\n✅ Done. Variants saved in variants-found.json");
}

// Simple menu with Bun’s prompt
async function showMenu() {
  console.log("\n=== Card Variant Scanner ===");
  console.log("1) Scan all sets (keep cache)");
  console.log("2) Update only failed cards");
  console.log("3) Rescan all (clear cache)");
  const choice = await prompt("Choose an option: ");
  return Number(choice);
}

// Entry point
(async function main() {
  const choice = await showMenu();
  if (choice === 1) {
    await scanCards(false);
  } else if (choice === 2) {
    await scanCards(true);
  } else if (choice === 3) {
    // Clear cache files
    await saveJson(CHECKED_FILE, {});
    await saveJson(VARIANTS_FILE, []);
    console.log("🗑 Cache cleared. Starting full rescan...");
    await scanCards(false);
  } else {
    console.log("Invalid choice");
  }
})();
