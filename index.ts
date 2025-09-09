import { readFile, writeFile, readdir } from "fs/promises";
//import fetch from "node-fetch";
import * as readline from "readline";

const BASE_URL = "https://www.cardmarket.com/it/Pokemon/Products/Singles/";
const CARD_SETS_DIR = "./card-sets";
const CHECKED_FILE = "./checked-cards.json";
const VARIANTS_FILE = "./variants-found.json";

// Structure of cached data
type CheckedCards = Record<string, { status: "ok" | "no-variants" | "error"; variants: string[] }>;

// Utility: load cache
async function loadCheckedCards(): Promise<CheckedCards> {
  try {
    const data = await readFile(CHECKED_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Utility: save cache
async function saveCheckedCards(data: CheckedCards) {
  await writeFile(CHECKED_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Utility: save variants found
async function saveVariants(data: CheckedCards) {
  const variants = Object.entries(data)
    .filter(([_, v]) => v.variants.length > 0)
    .map(([card, v]) => ({ card, variants: v.variants }));
  await writeFile(VARIANTS_FILE, JSON.stringify(variants, null, 2), "utf8");
}

// Utility: delay to avoid rate-limit
const delay = (ms = 3000) => new Promise((res) => setTimeout(res, ms));

// Check if a page exists
async function isDirectPage(url: string): Promise<boolean> {
  while (true) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.3",
      },
    });

    if (response.status === 429) {
      console.warn("⚠️ 429 Too Many Requests - waiting 60s...");
      await delay(60000);
      continue;
    }

    if (response.status === 403) {
      console.warn("⛔ 403 Forbidden - waiting 5min...");
      await delay(300000);
      continue;
    }

    return response.status === 200;
  }
}

// Parse cards from all txt files
async function loadAllCards(): Promise<{ set: string; cards: string[] }[]> {
  const files = await readdir(CARD_SETS_DIR);
  const sets: { set: string; cards: string[] }[] = [];

  for (const file of files) {
    if (!file.endsWith(".txt")) continue;
    const setName = file.replace(".txt", "");
    const content = await readFile(`${CARD_SETS_DIR}/${file}`, "utf8");
    const cards = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [number, ...nameParts] = line.split(/\s+/);
        const cardNumber = number.padStart(3, "0");
        const rawName = nameParts.join("-");
        const cleanedName = rawName
          .replace(/[\[\(].*?[\]\)]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        return `${cleanedName}-${setName}${cardNumber}`;
      });
    sets.push({ set: setName, cards });
  }

  return sets;
}

// Scan cards for variants
async function scanCards(updateOnlyErrors = false) {
  const allSets = await loadAllCards();
  const checked = await loadCheckedCards();

  for (const { set, cards } of allSets) {
    for (const card of cards) {
      // Skip if already known and not updating errors
      if (checked[card] && checked[card].status !== "error" && updateOnlyErrors) continue;
      if (checked[card] && checked[card].status !== "error" && !updateOnlyErrors) continue;

      console.log(`🔍 Checking ${card}...`);
      const slugV1 = `${BASE_URL}${set}/${card.replace(/-(\w+\d{3})$/, "-V1-$1")}`;
      try {
        const hasV1 = await isDirectPage(slugV1);
        if (!hasV1) {
          checked[card] = { status: "no-variants", variants: [] };
          console.log(`❌ No variants for ${card}`);
        } else {
          const variants: string[] = [slugV1];
          // Check V2..V5
          for (let i = 2; i <= 5; i++) {
            await delay();
            const slugVi = slugV1.replace("-V1-", `-V${i}-`);
            const hasVi = await isDirectPage(slugVi);
            if (hasVi) {
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

      await saveCheckedCards(checked);
      await saveVariants(checked);
      await delay();
    }
  }
  console.log("\n✅ Done. Variants saved in variants-found.json");
}

// Small menu
function showMenu(): Promise<number> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log("\n=== Card Variant Scanner ===");
    console.log("1) Scan all sets");
    console.log("2) Update only failed cards");
    rl.question("Choose an option: ", (answer) => {
      rl.close();
      resolve(Number(answer));
    });
  });
}

// Main
(async function main() {
  const choice = await showMenu();
  if (choice === 1) {
    await scanCards(false);
  } else if (choice === 2) {
    await scanCards(true);
  } else {
    console.log("Invalid choice");
  }
})();
