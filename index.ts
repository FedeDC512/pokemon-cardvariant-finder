import { readdir } from "fs/promises";

const BASE_URL = "https://www.cardmarket.com/en/Pokemon/Products/Singles/";
const CARD_SETS_DIR = "./card-sets";
const CHECKED_FILE = "./checked-cards.json";
const VARIANTS_FILE = "./variants-found.json";

type CheckedEntry = {
  status: "ok" | "no-variants" | "error";
  variants: string[];
  expansion?: string;
};
type CheckedCards = Record<string, CheckedEntry>;

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
    .map(([card, v]) => ({
      card,
      expansion: v.expansion || "Unknown",
      variants: v.variants
    }));
  await saveJson(VARIANTS_FILE, variants);
}

// Simple delay to avoid rate limiting
function randomDelay(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Check if a page exists
async function isDirectPage(url: string): Promise<boolean> {
  while (true) {
    const res = await fetch(url, { 
      method: "HEAD", // Use HEAD to reduce data transfer
      redirect: "manual" // Don't follow redirects
    });

    if (res.status === 429) {
      console.warn("⚠️ 429 Too Many Requests - waiting 60s...");
      await Bun.sleep(60000);
      continue;
    }
    if (res.status === 403) {
      console.warn("⛔ 403 Forbidden - waiting 5min...");
      await Bun.sleep(300000);
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

// Main scanning function
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
          const baseSlug = `${BASE_URL}${set}/${card}`;
          const hasBase = await isDirectPage(baseSlug);

          if (!hasBase) {
            console.error(`⛔ Base card not found for ${card}`);
            checked[card] = { status: "error", variants: [] };
          } else {
            console.log(`❌ No variants for ${card}, but base exists`);
            checked[card] = { status: "no-variants", variants: [] };
          }
        } else {
          const variants: string[] = [slugV1];

          for (let i = 2; i <= 5; i++) {
            await Bun.sleep(randomDelay(3000, 5000));
            const slugVi = slugV1.replace("-V1-", `-V${i}-`);
            if (await isDirectPage(slugVi)) {
              variants.push(slugVi);
              console.log(`✅ Variant found: ${slugVi}`);
            }
          }
          if (variants.length === 1) console.log(`❌ Only V1 variant found`);
          checked[card] = { status: "ok", variants, expansion: set.replace(/-/g, " ") };
        }
      } catch (err) {
        console.error(`⚠️ Error loading ${card}`, err);
        checked[card] = { status: "error", variants: [] };
      }

      await saveJson(CHECKED_FILE, checked);
      await saveVariants(checked);
      await Bun.sleep(randomDelay(3000, 5000));
    }
    console.log(`✅ Finished scanning expansion: ${set.replace(/-/g, " ")}\n`);
  }
  console.log("✅ Finished scanning all expansions");
}

// Simple menu with Bun’s prompt
async function showMenu() {
  console.log("\nCard Variant Scanner");
  console.log("1) Scan all sets (keep cache)");
  console.log("2) Update only failed cards");
  console.log("3) Rescan all (clear cache)");
  const choice = await prompt("Choose an option: ");
  return Number(choice);
}

// Main code
const choice = await showMenu();
if (choice === 1) {
  await scanCards(false);
} else if (choice === 2) {
  await scanCards(true);
} else if (choice === 3) {
  // Clear cache files
  await saveJson(CHECKED_FILE, {});
  await saveJson(VARIANTS_FILE, []);
  console.log("🗑️ Cache cleared. Starting full rescan...");
  await scanCards(false);
} else {
  console.log("Invalid choice");
}
