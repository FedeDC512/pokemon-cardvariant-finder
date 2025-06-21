import { readFile, writeFile } from 'fs/promises'
// import fetch from 'node-fetch'

const BASE_URL = 'https://www.cardmarket.com/it/Pokemon/Products/Singles/Scarlet-Violet/'
const SET_CODE = 'SVI' // Modifica questo per ogni espansione

async function readCardList(): Promise<string[]> {
  const data = await readFile('./card-sets/Scarlet-Violet.txt', 'utf8')
  return data
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [number, ...nameParts] = line.split(/\s+/)
      const cardNumber = number.padStart(3, '0')
      const rawName = nameParts.join('-')

      // Rimuove parentesi tonde e quadre e il loro contenuto
      const cleanedName = rawName.replace(/[\[\(].*?[\]\)]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')

      return `${cleanedName}-${SET_CODE}${cardNumber}`
    })
}

// Funzione che gestisce redirect e 429
async function isDirectPage(slug: string): Promise<boolean> {
  const url = BASE_URL + slug

  while (true) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36'
      }
    })

    console.log(`Controllando: ${url} -> status ${response.status}`)

    if (response.status === 429) {
      console.warn('⚠️ 429 Too Many Requests - Attendo 60 secondi...')
      await new Promise(resolve => setTimeout(resolve, 60000))
      continue
    }

    if (response.status === 403) {
      console.warn('⛔ 403 Forbidden - Possibile blocco temporaneo. Attendo 5 minuti...')
      await new Promise(resolve => setTimeout(resolve, 300000))
      continue
    }

    return response.status === 200 // Se la pagina è diretta, ritorna true
  }
}

// Pausa di 3 secondi
const delay = () => new Promise(resolve => setTimeout(resolve, 3000))


async function main() {
  const cards = await readCardList()
  const results: string[] = []

  for (const baseSlug of cards) {
    const slugV1 = baseSlug.replace(/-(SVI\d{3})$/, '-V1-$1')
    const isV1Direct = await isDirectPage(slugV1)

    if (isV1Direct) {
      console.log(`ℹ️ V1 caricata, cerco varianti da V2 a V5...`)

      for (let i = 2; i <= 5; i++) {
        const slugVi = slugV1.replace('-V1-', `-V${i}-`)
        await delay()
        const isDirect = await isDirectPage(slugVi)

        if (isDirect) {
          results.push(slugVi)
          console.log(`✅ Variante trovata: ${slugVi}`)
        }
      }
    } else {
      console.log(`❌ Nessuna variante (V1 non caricata): ${baseSlug}`)
    }

    await delay()
  }

  await writeFile('./variants-found.txt', results.join('\n'), 'utf8')
  console.log('\n✅ Varianti salvate in variants-found.txt')
}

main().catch(console.error)
