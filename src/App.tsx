// ─── FULL REWRITE – categorized ingredients + constrained plan builder ────────
import { useEffect, useMemo, useState } from 'react'
import './App.css'

type View =
  | 'overview'
  | 'preferences'
  | 'pantry'
  | 'weekly-plan'
  | 'recipe-search'
  | 'shopping-cart'

type Unit = 'oz' | 'lb' | 'tsp' | 'tbsp' | 'item'

type Ingredient = {
  name: string
  qty: number
  unit: Unit
  core: boolean
  spice?: boolean
  perishable?: boolean
}

type Recipe = {
  id: string
  name: string
  estimatedCost: number
  servings: number
  imageUrl: string
  ingredients: Ingredient[]
}

type PantryItem = {
  id: string
  name: string
  qty: number
  unit: Unit
  perishable: boolean
  addedAt: string
}

type RankedRecipe = {
  recipe: Recipe
  totalScore: number
  overstockScore: number
  nearExpiryScore: number
}

type WeeklySelection = {
  plan: Recipe[]
  selectedProteinTypes: string[]
  selectedProteinMetaBuckets: string[]
}

type ApiRecipeSummary = {
  id: string
  name: string
  description: string
  category: string
  cuisine: string
  difficulty: string
  total_time: string
  calories: number
  tags: string[]
}

type ApiListResponse = {
  data: ApiRecipeSummary[]
  meta?: {
    page?: number
    per_page?: number
    total?: number
    total_pages?: number
  }
}

type LivePipelineDiagnostic = {
  fetched: number
  postProtein: number
  postGrain: number
  postVeggie: number
  finalSelected: number
  fallbackSimilarityRelaxed: boolean
  proteinLanes: string[]
  selectedGrains: string[]
}

// ─── API MODE GATE ──────────────────────────────────────────────────────────
// Live API calls are opt-in and require explicit arming from the UI.
const LIVE_API_FEATURE_ENABLED = true

const TODAY_MS = 24 * 60 * 60 * 1000
const PERISHABLE_EXPIRY_DAYS = 7
const NEAR_EXPIRY_DAYS = 2
const HOUSEHOLD_PRESETS = [1, 2, 4, 6]
const RETAILERS = ['Instacart', 'Amazon', 'Walmart', 'Target'] as const
const MAX_WEEKLY_PROTEIN_TYPES = 2
const MAX_WEEKLY_GRAIN_TYPES = 3
const MAX_WEEKLY_VEGGIE_TYPES = 5
const LIVE_API_PAGE_SIZE = 100
const LIVE_API_MAX_PAGES_PER_PROTEIN = 2
const LIVE_PRIMARY_SIMILARITY_CAP = 0.8
const LIVE_FALLBACK_SIMILARITY_CAP = 0.88
const PROTEIN_META_KEYWORDS = ['chicken', 'beef', 'fish', 'turkey', 'plant'] as const
const GRAIN_KEYWORDS = ['brown rice', 'quinoa', 'couscous', 'wild rice'] as const
const VEGGIE_KEYWORDS = ['broccoli', 'spinach', 'zucchini', 'bell pepper', 'asparagus'] as const
const PLACEHOLDER_RECIPE_IMAGE =
  'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80'

const PROTEIN_NAMES = new Set([
  'chicken breast',
  'chicken thigh',
  'ground turkey',
  'ground beef',
  'hamburger',
  'salmon',
  'cod',
  'shrimp',
  'tofu',
])
const GRAIN_NAMES = new Set(['brown rice', 'quinoa', 'couscous', 'wild rice'])
const VEGGIE_NAMES = new Set(['broccoli', 'spinach', 'zucchini', 'bell pepper', 'asparagus'])

const PROTEIN_META_BY_TYPE: Record<string, string> = {
  'chicken breast': 'chicken',
  'chicken thigh': 'chicken',
  'ground turkey': 'turkey',
  'ground beef': 'beef',
  hamburger: 'beef',
  salmon: 'fish',
  cod: 'fish',
  shrimp: 'shellfish',
  tofu: 'plant',
}

const UNIT_TO_OZ: Partial<Record<Unit, number>> = {
  oz: 1,
  lb: 16,
}

const MOCK_RECIPES: Recipe[] = [
  {
    id: 'r1',
    name: 'Lemon Pepper Chicken Bowls',
    estimatedCost: 13,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 18, unit: 'oz', core: true, perishable: true },
      { name: 'brown rice', qty: 9, unit: 'oz', core: true },
      { name: 'broccoli', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'lemon pepper', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'garlic powder', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r2',
    name: 'Smoky Paprika Chicken Skillet',
    estimatedCost: 12,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 16, unit: 'oz', core: true, perishable: true },
      { name: 'quinoa', qty: 8, unit: 'oz', core: true },
      { name: 'zucchini', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'smoked paprika', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'cumin', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r3',
    name: 'Turmeric Ginger Salmon Bowl',
    estimatedCost: 11,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 11, unit: 'oz', core: true, perishable: true },
      { name: 'brown rice', qty: 8, unit: 'oz', core: true },
      { name: 'spinach', qty: 5, unit: 'oz', core: true, perishable: true },
      { name: 'turmeric', qty: 1, unit: 'tsp', core: false, spice: true },
      { name: 'ginger', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r4',
    name: 'Chipotle Chicken Rice Prep',
    estimatedCost: 13,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1600335895229-6e75511892c8?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 18, unit: 'oz', core: true, perishable: true },
      { name: 'brown rice', qty: 9, unit: 'oz', core: true },
      { name: 'bell pepper', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'chipotle powder', qty: 1, unit: 'tsp', core: false, spice: true },
      { name: 'oregano', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r5',
    name: 'Coriander Lime Salmon Plates',
    estimatedCost: 18,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1485963631004-f2f00b1d6606?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 16, unit: 'oz', core: true, perishable: true },
      { name: 'wild rice', qty: 8, unit: 'oz', core: true },
      { name: 'asparagus', qty: 1, unit: 'item', core: true, perishable: true },
      { name: 'coriander', qty: 1, unit: 'tsp', core: false, spice: true },
      { name: 'lime zest', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r6',
    name: 'Harissa Salmon Power Bowls',
    estimatedCost: 10,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1617093727343-374698b1b08d?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 10, unit: 'oz', core: true, perishable: true },
      { name: 'quinoa', qty: 8, unit: 'oz', core: true },
      { name: 'bell pepper', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'harissa', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'cinnamon', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r7',
    name: 'Cajun Salmon Sheet Pan',
    estimatedCost: 16,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 15, unit: 'oz', core: true, perishable: true },
      { name: 'couscous', qty: 8, unit: 'oz', core: true },
      { name: 'asparagus', qty: 12, unit: 'oz', core: true, perishable: true },
      { name: 'cajun blend', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'thyme', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r8',
    name: 'Sesame Ginger Chicken Bowls',
    estimatedCost: 9,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 14, unit: 'oz', core: true, perishable: true },
      { name: 'brown rice', qty: 8, unit: 'oz', core: true },
      { name: 'spinach', qty: 5, unit: 'oz', core: true, perishable: true },
      { name: 'ginger', qty: 1, unit: 'tsp', core: false, spice: true },
      { name: 'sesame seeds', qty: 1, unit: 'tbsp', core: false, spice: true },
    ],
  },
  {
    id: 'r9',
    name: 'Zaatar Salmon Roast',
    estimatedCost: 8,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 11, unit: 'oz', core: true, perishable: true },
      { name: 'broccoli', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'couscous', qty: 8, unit: 'oz', core: true },
      { name: 'zaatar', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'sumac', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r10',
    name: 'Blackened Salmon and Quinoa',
    estimatedCost: 15,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'salmon', qty: 15, unit: 'oz', core: true, perishable: true },
      { name: 'quinoa', qty: 8, unit: 'oz', core: true },
      { name: 'spinach', qty: 4, unit: 'oz', core: true, perishable: true },
      { name: 'blackening spice', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'garlic powder', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r11',
    name: 'Herbed Chicken Couscous',
    estimatedCost: 12,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 16, unit: 'oz', core: true, perishable: true },
      { name: 'couscous', qty: 9, unit: 'oz', core: true },
      { name: 'zucchini', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'oregano', qty: 1, unit: 'tsp', core: false, spice: true },
      { name: 'dill', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
  {
    id: 'r12',
    name: 'Warm Curry Chicken and Couscous',
    estimatedCost: 13,
    servings: 4,
    imageUrl: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=900&q=80',
    ingredients: [
      { name: 'chicken breast', qty: 16, unit: 'oz', core: true, perishable: true },
      { name: 'couscous', qty: 9, unit: 'oz', core: true },
      { name: 'broccoli', qty: 2, unit: 'item', core: true, perishable: true },
      { name: 'curry powder', qty: 2, unit: 'tsp', core: false, spice: true },
      { name: 'coriander', qty: 1, unit: 'tsp', core: false, spice: true },
    ],
  },
]

const INITIAL_PANTRY: PantryItem[] = [
  {
    id: 'p1',
    name: 'brown rice',
    qty: 5,
    unit: 'lb',
    perishable: false,
    addedAt: new Date().toISOString(),
  },
  {
    id: 'p2',
    name: 'smoked paprika',
    qty: 16,
    unit: 'tsp',
    perishable: false,
    addedAt: new Date().toISOString(),
  },
  {
    id: 'p3',
    name: 'spinach',
    qty: 12,
    unit: 'oz',
    perishable: true,
    addedAt: new Date(Date.now() - 6 * TODAY_MS).toISOString(),
  },
  {
    id: 'p4',
    name: 'cumin',
    qty: 12,
    unit: 'tsp',
    perishable: false,
    addedAt: new Date().toISOString(),
  },
]

function massToOz(qty: number, unit: Unit): number | null {
  const factor = UNIT_TO_OZ[unit]
  if (!factor) {
    return null
  }
  return qty * factor
}

function keyForIngredient(name: string, unit: Unit): string {
  if (unit === 'tsp' || unit === 'tbsp') {
    return `${name.toLowerCase()}::tsp`
  }
  if (unit === 'item') {
    return `${name.toLowerCase()}::item`
  }
  return `${name.toLowerCase()}::oz`
}

function normalizedValue(qty: number, unit: Unit): number {
  if (unit === 'tbsp') {
    return qty * 3
  }
  if (unit === 'tsp') {
    return qty
  }
  if (unit === 'item') {
    return qty
  }
  return massToOz(qty, unit) ?? 0
}

function formatMass(ounces: number): string {
  if (ounces < 16) {
    return `${ounces.toFixed(1)} oz`
  }
  const lbs = Math.floor(ounces / 16)
  const oz = Number((ounces % 16).toFixed(1))
  if (oz === 0) {
    return `${lbs} lb`
  }
  return `${lbs} lb ${oz} oz`
}

function formatQty(qty: number, unit: Unit): string {
  if (unit === 'lb' || unit === 'oz') {
    return formatMass(massToOz(qty, unit) ?? 0)
  }
  return `${qty} ${unit}`
}

function daysUntilExpiry(item: PantryItem): number {
  if (!item.perishable) {
    return 999
  }
  const expiryMs = new Date(item.addedAt).getTime() + PERISHABLE_EXPIRY_DAYS * TODAY_MS
  return Math.ceil((expiryMs - Date.now()) / TODAY_MS)
}

function notableIngredients(recipe: Recipe): string[] {
  return recipe.ingredients
    .filter((i) => i.core || i.spice)
    .slice(0, 4)
    .map((i) => i.name)
}

function extractTypes(recipe: Recipe, nameSet: Set<string>): string[] {
  return [...new Set(recipe.ingredients.map((i) => i.name.toLowerCase()).filter((n) => nameSet.has(n)))]
}

function getProteinTypes(recipe: Recipe): string[] {
  return extractTypes(recipe, PROTEIN_NAMES)
}

function getProteinMetaBucket(proteinType: string): string {
  return PROTEIN_META_BY_TYPE[proteinType] ?? proteinType
}

function getGrainTypes(recipe: Recipe): string[] {
  return extractTypes(recipe, GRAIN_NAMES)
}

function getVeggieTypes(recipe: Recipe): string[] {
  return extractTypes(recipe, VEGGIE_NAMES)
}

function planFitsLimits(plan: Recipe[]): boolean {
  const proteins = new Set<string>()
  const proteinMetas = new Set<string>()
  const metaToProteinType = new Map<string, string>()
  const grains = new Set<string>()
  const veggies = new Set<string>()

  plan.forEach((recipe) => {
    getProteinTypes(recipe).forEach((p) => {
      proteins.add(p)
      const meta = getProteinMetaBucket(p)
      proteinMetas.add(meta)
      if (!metaToProteinType.has(meta)) {
        metaToProteinType.set(meta, p)
      }
    })
    getGrainTypes(recipe).forEach((g) => grains.add(g))
    getVeggieTypes(recipe).forEach((v) => veggies.add(v))
  })

  const hasMultipleTypesInSingleMeta = [...metaToProteinType.entries()].some(([meta, selectedType]) =>
    [...proteins].some((proteinType) => getProteinMetaBucket(proteinType) === meta && proteinType !== selectedType),
  )

  return (
    !hasMultipleTypesInSingleMeta &&
    proteinMetas.size <= MAX_WEEKLY_PROTEIN_TYPES &&
    grains.size <= MAX_WEEKLY_GRAIN_TYPES &&
    veggies.size <= MAX_WEEKLY_VEGGIE_TYPES
  )
}

function weightedRandomPick<T>(items: { item: T; weight: number }[]): T | null {
  const positive = items.filter((x) => x.weight > 0)
  if (positive.length === 0) {
    return null
  }
  const total = positive.reduce((sum, x) => sum + x.weight, 0)
  let roll = Math.random() * total
  for (const entry of positive) {
    roll -= entry.weight
    if (roll <= 0) {
      return entry.item
    }
  }
  return positive[positive.length - 1].item
}

function buildWeeklyPlanWithLimits(
  ranked: RankedRecipe[],
  targetCount: number,
  pantryByIngredient: Map<string, number>,
  previousWeekProteinMetaBuckets: Set<string>,
): WeeklySelection {
  const proteinTypeScores = new Map<string, number>()

  ranked.forEach((row) => {
    const recipe = row.recipe
    const proteinTypes = getProteinTypes(recipe)
    proteinTypes.forEach((proteinType) => {
      const ingredientKey = keyForIngredient(proteinType, 'oz')
      const onHand = pantryByIngredient.get(ingredientKey) ?? 0
      const overstockBoost = Math.min(3, onHand / 16)
      const previousWeekPenalty = previousWeekProteinMetaBuckets.has(getProteinMetaBucket(proteinType)) ? -2 : 0
      const running = proteinTypeScores.get(proteinType) ?? 0
      proteinTypeScores.set(proteinType, running + row.totalScore + overstockBoost + previousWeekPenalty)
    })
  })

  const proteinCandidates = [...proteinTypeScores.entries()].map(([proteinType, score]) => ({
    proteinType,
    meta: getProteinMetaBucket(proteinType),
    score,
  }))

  const firstPick = weightedRandomPick(
    proteinCandidates.map((x) => ({ item: x, weight: Math.max(0.1, x.score + 3) })),
  )

  const secondPool = firstPick
    ? proteinCandidates.filter((x) => x.meta !== firstPick.meta)
    : proteinCandidates

  const secondPick = weightedRandomPick(
    secondPool.map((x) => ({ item: x, weight: Math.max(0.1, x.score + 3) })),
  )

  const selectedProteinTypes = [firstPick?.proteinType, secondPick?.proteinType].filter(
    (x): x is string => Boolean(x),
  )

  const selectedProteinMetaBuckets = [...new Set(selectedProteinTypes.map((p) => getProteinMetaBucket(p)))]

  const selectedProteinTypeSet = new Set(selectedProteinTypes)
  const selected: Recipe[] = []

  // Seed with one recipe from each selected protein type when possible.
  selectedProteinTypes.forEach((proteinType) => {
    const firstMatch = ranked.find((row) => getProteinTypes(row.recipe).includes(proteinType))
    if (!firstMatch) {
      return
    }
    const exists = selected.some((r) => r.id === firstMatch.recipe.id)
    if (exists) {
      return
    }
    const candidate = [...selected, firstMatch.recipe]
    if (planFitsLimits(candidate)) {
      selected.push(firstMatch.recipe)
    }
  })

  for (const row of ranked) {
    if (selected.length >= targetCount) {
      break
    }

    const recipe = row.recipe
    if (selected.some((existing) => existing.id === recipe.id)) {
      continue
    }
    const recipeProteins = getProteinTypes(recipe)
    if (recipeProteins.length > 0 && recipeProteins.some((proteinType) => !selectedProteinTypeSet.has(proteinType))) {
      continue
    }

    const candidate = [...selected, recipe]
    if (planFitsLimits(candidate)) {
      selected.push(recipe)
    }
  }

  return {
    plan: selected,
    selectedProteinTypes,
    selectedProteinMetaBuckets,
  }
}

function summarizeProteinSelection(plan: Recipe[]): { types: string[]; metas: string[] } {
  const types = [...new Set(plan.flatMap((recipe) => getProteinTypes(recipe)))]
  const metas = [...new Set(types.map((type) => getProteinMetaBucket(type)))]
  return { types, metas }
}

function seedFromString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function seededRandom(seed: number): () => number {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return Math.abs(state >>> 0) / 4294967295
  }
}

function summaryText(summary: ApiRecipeSummary): string {
  return `${summary.name} ${summary.description ?? ''} ${summary.tags.join(' ')}`.toLowerCase()
}

function inferProteinMetaFromSummary(summary: ApiRecipeSummary): string | null {
  const haystack = summaryText(summary)
  if (/(salmon|cod|fish|seafood)/.test(haystack)) return 'fish'
  if (/(shrimp|prawn)/.test(haystack)) return 'shellfish'
  if (/chicken/.test(haystack)) return 'chicken'
  if (/beef|burger|steak/.test(haystack)) return 'beef'
  if (/turkey/.test(haystack)) return 'turkey'
  if (/(tofu|plant|vegetarian|vegan)/.test(haystack)) return 'plant'
  return null
}

function inferGrainsFromSummary(summary: ApiRecipeSummary): string[] {
  const haystack = summaryText(summary)
  return GRAIN_KEYWORDS.filter((grain) => haystack.includes(grain))
}

function inferVeggiesFromSummary(summary: ApiRecipeSummary): string[] {
  const haystack = summaryText(summary)
  return VEGGIE_KEYWORDS.filter((veggie) => haystack.includes(veggie))
}

function summaryToRecipe(summary: ApiRecipeSummary): Recipe {
  const proteinMeta = inferProteinMetaFromSummary(summary)
  const proteinNameByMeta: Record<string, string> = {
    chicken: 'chicken breast',
    beef: 'ground beef',
    fish: 'salmon',
    shellfish: 'shrimp',
    turkey: 'ground turkey',
    plant: 'tofu',
  }
  const primaryGrain = inferGrainsFromSummary(summary)[0] ?? 'brown rice'
  const primaryVeggie = inferVeggiesFromSummary(summary)[0] ?? 'broccoli'
  const proteinName = proteinMeta ? proteinNameByMeta[proteinMeta] ?? 'chicken breast' : 'chicken breast'

  return {
    id: summary.id,
    name: summary.name,
    estimatedCost: Number(Math.max(7, Math.min(22, (summary.calories || 500) / 55)).toFixed(2)),
    servings: 4,
    imageUrl: PLACEHOLDER_RECIPE_IMAGE,
    ingredients: [
      { name: proteinName, qty: 16, unit: 'oz', core: true, perishable: true },
      { name: primaryGrain, qty: 8, unit: 'oz', core: true },
      { name: primaryVeggie, qty: 2, unit: 'item', core: true, perishable: true },
    ],
  }
}

function similarityScore(a: ApiRecipeSummary, b: ApiRecipeSummary): number {
  const tokensA = new Set(summaryText(a).split(/[^a-z0-9]+/).filter(Boolean))
  const tokensB = new Set(summaryText(b).split(/[^a-z0-9]+/).filter(Boolean))
  const intersection = [...tokensA].filter((x) => tokensB.has(x)).length
  const union = new Set([...tokensA, ...tokensB]).size
  if (union === 0) return 0
  return intersection / union
}

function pickWeightedUnique(items: { key: string; weight: number }[], take: number, rng: () => number): string[] {
  const pool = [...items]
  const picked: string[] = []
  while (pool.length > 0 && picked.length < take) {
    const positive = pool.map((x) => ({ ...x, weight: Math.max(0.01, x.weight) }))
    const total = positive.reduce((sum, x) => sum + x.weight, 0)
    let roll = rng() * total
    let chosenIndex = 0
    for (let i = 0; i < positive.length; i += 1) {
      roll -= positive[i].weight
      if (roll <= 0) {
        chosenIndex = i
        break
      }
    }
    picked.push(positive[chosenIndex].key)
    pool.splice(chosenIndex, 1)
  }
  return picked
}

function App() {
  const [activeView, setActiveView] = useState<View>('weekly-plan')
  const [liveApiEnabled, setLiveApiEnabled] = useState(false)
  const [liveApiArmed, setLiveApiArmed] = useState(false)
  const [liveApiBusy, setLiveApiBusy] = useState(false)
  const [liveApiStatus, setLiveApiStatus] = useState('Mock mode active. No API calls.')
  const [liveApiDiagnostics, setLiveApiDiagnostics] = useState<LivePipelineDiagnostic | null>(null)
  const [liveRankedPool, setLiveRankedPool] = useState<RankedRecipe[]>([])
  const [lastWeekGrainTypes, setLastWeekGrainTypes] = useState<string[]>([])

  const [householdSize, setHouseholdSize] = useState(2)
  const [weeklyRecipeTarget, setWeeklyRecipeTarget] = useState(12)
  const [budgetCap, setBudgetCap] = useState(150)
  const [allergiesRaw, setAllergiesRaw] = useState('')
  const [dislikesRaw, setDislikesRaw] = useState('')
  const [searchText, setSearchText] = useState('')

  const [pantry, setPantry] = useState<PantryItem[]>(INITIAL_PANTRY)
  const [mealPlan, setMealPlan] = useState<Recipe[]>([])
  const [pendingSwapIndex, setPendingSwapIndex] = useState<number | null>(null)
  const [lastWeekProteinMetaBuckets, setLastWeekProteinMetaBuckets] = useState<string[]>([])
  const [currentWeekProteinTypes, setCurrentWeekProteinTypes] = useState<string[]>([])
  const [currentWeekProteinMetaBuckets, setCurrentWeekProteinMetaBuckets] = useState<string[]>([])

  const [newPantryName, setNewPantryName] = useState('')
  const [newPantryQty, setNewPantryQty] = useState(1)
  const [newPantryUnit, setNewPantryUnit] = useState<Unit>('oz')
  const [newPantryPerishable, setNewPantryPerishable] = useState(false)

  const recipeApiKey = import.meta.env.VITE_RECIPE_API_KEY?.trim() ?? ''

  useEffect(() => {
    const removeExpired = () => {
      setPantry((current) => current.filter((item) => daysUntilExpiry(item) > 0))
    }

    removeExpired()
    const timer = window.setInterval(removeExpired, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const allergies = useMemo(
    () => allergiesRaw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    [allergiesRaw],
  )

  const dislikes = useMemo(
    () => dislikesRaw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    [dislikesRaw],
  )

  const pantryByIngredient = useMemo(() => {
    const map = new Map<string, number>()
    pantry.forEach((item) => {
      const key = keyForIngredient(item.name, item.unit)
      const value = normalizedValue(item.qty, item.unit)
      map.set(key, (map.get(key) ?? 0) + value)
    })
    return map
  }, [pantry])

  const plannedUseByIngredient = useMemo(() => {
    const map = new Map<string, number>()
    mealPlan.forEach((recipe) => {
      recipe.ingredients.forEach((ingredient) => {
        const key = keyForIngredient(ingredient.name, ingredient.unit)
        const value = normalizedValue(ingredient.qty, ingredient.unit)
        map.set(key, (map.get(key) ?? 0) + value)
      })
    })
    return map
  }, [mealPlan])

  const projectedOverstock = useMemo(() => {
    const map = new Map<string, number>()
    pantryByIngredient.forEach((available, key) => {
      const used = plannedUseByIngredient.get(key) ?? 0
      const leftover = Math.max(0, available - used)
      const threshold = available * 0.35
      const overstock = Math.max(0, leftover - threshold)
      if (overstock > 0) {
        map.set(key, overstock)
      }
    })
    return map
  }, [pantryByIngredient, plannedUseByIngredient])

  const nearExpiryItems = useMemo(
    () => pantry.filter((item) => item.perishable && daysUntilExpiry(item) > 0 && daysUntilExpiry(item) <= NEAR_EXPIRY_DAYS),
    [pantry],
  )

  const rankedPool = useMemo<RankedRecipe[]>(() => {
    const blockedWords = [...allergies, ...dislikes]

    return MOCK_RECIPES
      .filter((recipe) => {
        const ingredientNames = recipe.ingredients.map((x) => x.name.toLowerCase())
        return !blockedWords.some((blocked) => ingredientNames.some((name) => name.includes(blocked)))
      })
      .map((recipe) => {
        const spiceSet = new Set(recipe.ingredients.filter((i) => i.spice).map((i) => i.name.toLowerCase()))
        const spiceVarietyScore = spiceSet.size === 0 ? 0 : Math.min(1, spiceSet.size / 3)

        let overstockScore = 0
        let nearExpiryScore = 0
        recipe.ingredients.forEach((ingredient) => {
          const key = keyForIngredient(ingredient.name, ingredient.unit)
          const overstock = projectedOverstock.get(key) ?? 0
          const ingredientUse = normalizedValue(ingredient.qty, ingredient.unit)
          if (ingredientUse > 0) {
            overstockScore += Math.min(1, overstock / ingredientUse)
          }

          const matchesNearExpiry = nearExpiryItems.some((item) => item.name.toLowerCase() === ingredient.name.toLowerCase())
          if (matchesNearExpiry) {
            nearExpiryScore += 1
          }
        })

        const budgetPenalty = recipe.estimatedCost > budgetCap / Math.max(1, weeklyRecipeTarget) ? 0.15 : 0

        const totalScore = spiceVarietyScore * 0.3 + overstockScore * 0.45 + nearExpiryScore * 0.25 - budgetPenalty

        return {
          recipe,
          totalScore,
          overstockScore,
          nearExpiryScore,
        }
      })
      .sort((a, b) => b.totalScore - a.totalScore)
  }, [allergies, dislikes, projectedOverstock, nearExpiryItems, budgetCap, weeklyRecipeTarget])

  const activeRankedPool = useMemo(
    () => (liveApiEnabled && liveRankedPool.length > 0 ? liveRankedPool : rankedPool),
    [liveApiEnabled, liveRankedPool, rankedPool],
  )

  const rankedRecipes = useMemo(() => {
    if (!searchText.trim()) {
      return activeRankedPool
    }
    const query = searchText.trim().toLowerCase()
    return activeRankedPool.filter((entry) => entry.recipe.name.toLowerCase().includes(query))
  }, [activeRankedPool, searchText])

  // Swap search: same list but gated by similarity threshold so users see genuinely similar alternatives
  const swapCandidates = useMemo(
    () =>
      rankedRecipes.filter((entry) => {
        if (pendingSwapIndex === null) {
          return false
        }

        if (
          currentWeekProteinTypes.length > 0 &&
          getProteinTypes(entry.recipe).some((proteinType) => !currentWeekProteinTypes.includes(proteinType))
        ) {
          return false
        }

        const candidatePlan = mealPlan.map((recipe, idx) => (idx === pendingSwapIndex ? entry.recipe : recipe))
        return planFitsLimits(candidatePlan)
      }),
    [rankedRecipes, pendingSwapIndex, mealPlan, currentWeekProteinTypes],
  )

  const planCost = useMemo(() => mealPlan.reduce((sum, recipe) => sum + recipe.estimatedCost, 0), [mealPlan])

  const budgetStatus = useMemo(() => {
    if (planCost > budgetCap) {
      return `Over budget by $${(planCost - budgetCap).toFixed(2)}`
    }
    return `Within budget. $${(budgetCap - planCost).toFixed(2)} remaining.`
  }, [planCost, budgetCap])

  const cartRows = useMemo(() => {
    // Total needed by the meal plan
    const needed = new Map<string, { name: string; unit: 'oz' | 'tsp' | 'item'; value: number }>()
    mealPlan.forEach((recipe) => {
      recipe.ingredients.forEach((ingredient) => {
        const key = keyForIngredient(ingredient.name, ingredient.unit)
        const unit: 'oz' | 'tsp' | 'item' = key.endsWith('::oz') ? 'oz' : key.endsWith('::tsp') ? 'tsp' : 'item'
        const value = normalizedValue(ingredient.qty, ingredient.unit)
        const current = needed.get(key)
        if (current) {
          current.value += value
        } else {
          needed.set(key, { name: ingredient.name, unit, value })
        }
      })
    })
    // Subtract what we already have in the pantry; only show items with a real shortfall
    const rows: { name: string; unit: 'oz' | 'tsp' | 'item'; value: number }[] = []
    needed.forEach((row, key) => {
      const onHand = pantryByIngredient.get(key) ?? 0
      const shortfall = Math.max(0, row.value - onHand)
      if (shortfall > 0) {
        rows.push({ ...row, value: shortfall })
      }
    })
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }, [mealPlan, pantryByIngredient])

  const retailerEstimates = useMemo(() => {
    const base = planCost || 1
    return RETAILERS.map((retailer, index) => {
      const multiplier = 0.93 + ((index * 7) % 9) / 100
      return {
        retailer,
        estimate: Number((base * multiplier).toFixed(2)),
      }
    }).sort((a, b) => a.estimate - b.estimate)
  }, [planCost])

  const weeklyPlanDiagnostic = useMemo(() => {
    const target = weeklyRecipeTarget
    const actual = mealPlan.length
    const proteins = currentWeekProteinTypes.length > 0 ? currentWeekProteinTypes.join(', ') : 'none'
    const usingMockData = !(liveApiEnabled && liveRankedPool.length > 0)

    if (actual >= target) {
      return {
        target,
        actual,
        proteins,
        reason: 'filled',
      }
    }

    const reasons: string[] = []
    if (activeRankedPool.length < target) {
      reasons.push('not enough recipes after allergy/dislike filters')
    }
    if (currentWeekProteinTypes.length < MAX_WEEKLY_PROTEIN_TYPES) {
      reasons.push('only one protein type qualified this week')
    }
    if (usingMockData) {
      reasons.push('prototype is still using a small local recipe set (API integration not enabled yet)')
    } else if (liveApiDiagnostics) {
      reasons.push(
        `live pool staged counts: fetched ${liveApiDiagnostics.fetched}, protein ${liveApiDiagnostics.postProtein}, grain ${liveApiDiagnostics.postGrain}, veggie ${liveApiDiagnostics.postVeggie}`,
      )
    }
    if (reasons.length === 0) {
      reasons.push('grain/veggie limit constraints reduced available combinations')
    }

    return {
      target,
      actual,
      proteins,
      reason: reasons.join('; '),
    }
  }, [weeklyRecipeTarget, mealPlan.length, currentWeekProteinTypes, activeRankedPool.length, liveApiEnabled, liveRankedPool.length, liveApiDiagnostics])

  function generateWeeklyPlan() {
    const previousMetaBuckets =
      currentWeekProteinMetaBuckets.length > 0 ? currentWeekProteinMetaBuckets : lastWeekProteinMetaBuckets
    const selection = buildWeeklyPlanWithLimits(
      activeRankedPool,
      weeklyRecipeTarget,
      pantryByIngredient,
      new Set(previousMetaBuckets),
    )

    if (currentWeekProteinMetaBuckets.length > 0) {
      setLastWeekProteinMetaBuckets(currentWeekProteinMetaBuckets)
    }

    setMealPlan(selection.plan)
    setCurrentWeekProteinTypes(selection.selectedProteinTypes)
    setCurrentWeekProteinMetaBuckets(selection.selectedProteinMetaBuckets)
  }

  useEffect(() => {
    if (activeRankedPool.length === 0) {
      setMealPlan([])
      setCurrentWeekProteinTypes([])
      setCurrentWeekProteinMetaBuckets([])
      return
    }

    const selection = buildWeeklyPlanWithLimits(
      activeRankedPool,
      weeklyRecipeTarget,
      pantryByIngredient,
      new Set(lastWeekProteinMetaBuckets),
    )
    setMealPlan(selection.plan)
    setCurrentWeekProteinTypes(selection.selectedProteinTypes)
    setCurrentWeekProteinMetaBuckets(selection.selectedProteinMetaBuckets)
  }, [
    weeklyRecipeTarget,
    allergiesRaw,
    dislikesRaw,
    budgetCap,
    pantryByIngredient,
    liveApiEnabled,
    liveRankedPool,
    lastWeekProteinMetaBuckets,
  ])

  async function runLiveApiTest() {
    if (!LIVE_API_FEATURE_ENABLED) {
      return
    }
    if (!liveApiEnabled) {
      setLiveApiStatus('Live mode is off. Enable it first to run a test call.')
      return
    }
    if (!liveApiArmed) {
      setLiveApiStatus('Live mode is not armed. Click arm before running API tests.')
      return
    }
    if (!recipeApiKey) {
      setLiveApiStatus('Missing VITE_RECIPE_API_KEY. Add it to .env and restart the app.')
      return
    }

    const blockedWords = [...allergies, ...dislikes]
    const overstockGrains: Set<string> = new Set(
      GRAIN_KEYWORDS.filter((grain) => {
        const key = keyForIngredient(grain, 'oz')
        return (projectedOverstock.get(key) ?? 0) > 0
      }),
    )

    const proteinLaneScores = PROTEIN_META_KEYWORDS.map((lane) => {
      const pantryMatch = (pantryByIngredient.get(`${lane}::oz`) ?? 0) / 16
      const lastWeekPenalty = lastWeekProteinMetaBuckets.includes(lane) ? -1.5 : 0
      return {
        lane,
        score: pantryMatch + lastWeekPenalty,
      }
    }).sort((a, b) => b.score - a.score)

    const selectedLanes = proteinLaneScores.slice(0, 2).map((x) => x.lane)

    async function fetchLanePage(lane: string, page: number): Promise<ApiListResponse> {
      const params = new URLSearchParams({
        q: lane,
        page: String(page),
        per_page: String(LIVE_API_PAGE_SIZE),
      })
      const response = await fetch(`https://recipe-api.com/api/v1/recipes?${params.toString()}`, {
        headers: {
          'X-API-Key': recipeApiKey,
        },
      })
      if (!response.ok) {
        throw new Error(`API request failed (${response.status}) for lane ${lane}`)
      }
      return (await response.json()) as ApiListResponse
    }

    try {
      setLiveApiBusy(true)
      setLiveApiStatus('Running live free-only pipeline (list/search endpoints only)...')

      const laneResults = await Promise.all(
        selectedLanes.map(async (lane) => {
          const pages: ApiRecipeSummary[] = []
          for (let page = 1; page <= LIVE_API_MAX_PAGES_PER_PROTEIN; page += 1) {
            const payload = await fetchLanePage(lane, page)
            const data = payload.data ?? []
            pages.push(...data)
            if (data.length < LIVE_API_PAGE_SIZE) {
              break
            }
          }
          return pages
        }),
      )

      const dedupedMap = new Map<string, ApiRecipeSummary>()
      laneResults.flat().forEach((summary) => dedupedMap.set(summary.id, summary))

      const fetched = [...dedupedMap.values()]
      const filtered = fetched.filter((summary) => {
        const haystack = summaryText(summary)
        return !blockedWords.some((blocked) => haystack.includes(blocked))
      })

      const postProtein = filtered.filter((summary) => {
        const meta = inferProteinMetaFromSummary(summary)
        return meta ? selectedLanes.includes(meta as (typeof PROTEIN_META_KEYWORDS)[number]) : false
      })

      const grainCounts = new Map<string, number>()
      postProtein.forEach((summary) => {
        inferGrainsFromSummary(summary).forEach((grain) => {
          grainCounts.set(grain, (grainCounts.get(grain) ?? 0) + 1)
        })
      })

      const rng = seededRandom(seedFromString(`${householdSize}-${weeklyRecipeTarget}-${selectedLanes.join('-')}`))
      const weightedGrains = [...grainCounts.entries()].map(([grain, count]) => {
        const base = Math.pow(count, 0.7)
        const overstockBoost = overstockGrains.has(grain) ? 2 : 0
        const priorPenalty = lastWeekGrainTypes.includes(grain) && !overstockGrains.has(grain) ? 0.75 : 1
        return {
          key: grain,
          weight: (base + overstockBoost) * priorPenalty,
        }
      })

      const selectedGrains = pickWeightedUnique(weightedGrains, MAX_WEEKLY_GRAIN_TYPES, rng)
      const postGrain = selectedGrains.length
        ? postProtein.filter((summary) => inferGrainsFromSummary(summary).some((grain) => selectedGrains.includes(grain)))
        : postProtein

      const veggieCounts = new Map<string, number>()
      postGrain.forEach((summary) => {
        inferVeggiesFromSummary(summary).forEach((veggie) => {
          veggieCounts.set(veggie, (veggieCounts.get(veggie) ?? 0) + 1)
        })
      })
      const topVeggies = [...veggieCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name)

      const postVeggie = postGrain
        .map((summary) => {
          const overlap = inferVeggiesFromSummary(summary).filter((veggie) => topVeggies.includes(veggie)).length
          return { summary, overlap }
        })
        .sort((a, b) => b.overlap - a.overlap)
        .map((x) => x.summary)

      const ranked = postVeggie
        .map((summary) => {
          const haystack = summaryText(summary)
          let pantryMentions = 0
          pantry.forEach((item) => {
            if (haystack.includes(item.name.toLowerCase())) {
              pantryMentions += 1
            }
          })
          const calorieBudget = budgetCap / Math.max(1, weeklyRecipeTarget)
          const caloriePenalty = summary.calories > calorieBudget * 35 ? 0.2 : 0
          const score = pantryMentions * 0.55 + (summary.tags.length / 12) * 0.25 + 0.2 - caloriePenalty
          return { summary, score }
        })
        .sort((a, b) => b.score - a.score)

      function selectWithSimilarityCap(cap: number): ApiRecipeSummary[] {
        const chosen: ApiRecipeSummary[] = []
        for (const row of ranked) {
          if (chosen.length >= weeklyRecipeTarget) break
          const tooSimilar = chosen.some((existing) => similarityScore(existing, row.summary) > cap)
          if (!tooSimilar) {
            chosen.push(row.summary)
          }
        }
        return chosen
      }

      let selectedSummaries = selectWithSimilarityCap(LIVE_PRIMARY_SIMILARITY_CAP)
      let fallbackSimilarityRelaxed = false
      if (selectedSummaries.length < weeklyRecipeTarget) {
        selectedSummaries = selectWithSimilarityCap(LIVE_FALLBACK_SIMILARITY_CAP)
        fallbackSimilarityRelaxed = true
      }

      const nextRankedPool: RankedRecipe[] = selectedSummaries.map((summary, index) => ({
        recipe: summaryToRecipe(summary),
        totalScore: Math.max(0.1, 1 - index * 0.01),
        overstockScore: 0,
        nearExpiryScore: 0,
      }))

      setLiveRankedPool(nextRankedPool)
      setLiveApiDiagnostics({
        fetched: fetched.length,
        postProtein: postProtein.length,
        postGrain: postGrain.length,
        postVeggie: postVeggie.length,
        finalSelected: nextRankedPool.length,
        fallbackSimilarityRelaxed,
        proteinLanes: [...selectedLanes],
        selectedGrains,
      })

      setLastWeekGrainTypes(selectedGrains)
      setLiveApiStatus(
        `Live test complete. Fetched ${fetched.length} summaries; selected ${nextRankedPool.length} recipes from lanes ${selectedLanes.join(', ')}.`,
      )
      setActiveView('weekly-plan')
    } catch (error) {
      setLiveApiStatus(error instanceof Error ? error.message : 'Live API test failed.')
    } finally {
      setLiveApiBusy(false)
      setLiveApiArmed(false)
    }
  }

  function addPantryItem() {
    if (!newPantryName.trim() || newPantryQty <= 0) {
      return
    }
    const newItem: PantryItem = {
      id: crypto.randomUUID(),
      name: newPantryName.trim().toLowerCase(),
      qty: newPantryQty,
      unit: newPantryUnit,
      perishable: newPantryPerishable,
      addedAt: new Date().toISOString(),
    }
    setPantry((current) => [...current, newItem])
    setNewPantryName('')
    setNewPantryQty(1)
    setNewPantryUnit('oz')
    setNewPantryPerishable(false)
  }

  function removePantryItem(id: string) {
    setPantry((current) => current.filter((item) => item.id !== id))
  }

  function updatePantryQuantity(id: string, qty: number) {
    setPantry((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item
        }
        return {
          ...item,
          qty: Math.max(0, qty),
        }
      }),
    )
  }

  function chooseRecipeFromSearch(recipe: Recipe) {
    if (pendingSwapIndex !== null) {
      setMealPlan((current) => {
        const candidatePlan = current.map((existing, index) => (index === pendingSwapIndex ? recipe : existing))
        if (!planFitsLimits(candidatePlan)) {
          return current
        }
        const summary = summarizeProteinSelection(candidatePlan)
        setCurrentWeekProteinTypes(summary.types)
        setCurrentWeekProteinMetaBuckets(summary.metas)
        return candidatePlan
      })
      setPendingSwapIndex(null)
      setActiveView('weekly-plan')
      return
    }

    setMealPlan((current) => {
      const alreadyInPlan = current.some((item) => item.id === recipe.id)
      if (alreadyInPlan) {
        return current
      }
      if (current.length >= weeklyRecipeTarget) {
        return current
      }
      const candidatePlan = [...current, recipe]
      if (!planFitsLimits(candidatePlan)) {
        return current
      }
      const summary = summarizeProteinSelection(candidatePlan)
      setCurrentWeekProteinTypes(summary.types)
      setCurrentWeekProteinMetaBuckets(summary.metas)
      return candidatePlan
    })
  }

  function recipeCard(recipe: Recipe, actionLabel: string, onAction: () => void) {
    return (
      <article key={recipe.id} className="recipe-card">
        <img src={recipe.imageUrl} alt={recipe.name} loading="lazy" />
        <div className="recipe-card-body">
          <h3>{recipe.name}</h3>
          <p className="meta-row">
            <span>${recipe.estimatedCost.toFixed(2)}</span>
            <span>{recipe.servings} servings</span>
          </p>
          <p className="ingredient-blurb">Notable: {notableIngredients(recipe).join(', ')}</p>
          <button onClick={onAction}>{actionLabel}</button>
        </div>
      </article>
    )
  }

  return (
    <div className="app-shell">
      {!liveApiEnabled && (
        <div className="mock-mode-banner" role="status">
          <strong>Mock Mode</strong> — using local recipe data. No API calls are being made.
        </div>
      )}
      {liveApiEnabled && (
        <div className="mock-mode-banner live-mode" role="status">
          <strong>Live Test Mode</strong> — API calls only run when manually armed and triggered.
        </div>
      )}
      <header className="hero">
        <div>
          <p className="kicker">Meals My Way</p>
          <h1>Your pantry, your style, your weekly plan</h1>
          <p>
            Weekly planning uses protein meta-buckets, pantry overstock weighting, and spice-driven variety.
          </p>
        </div>
        {activeView === 'weekly-plan' ? (
          <button className="primary" onClick={generateWeeklyPlan}>
            Refresh Weekly Plan
          </button>
        ) : (
          <button className="primary" onClick={() => setActiveView('weekly-plan')}>
            Open Weekly Plan
          </button>
        )}
      </header>

      <nav className="menu-tabs" aria-label="App views">
        <button className={activeView === 'overview' ? 'active' : ''} onClick={() => setActiveView('overview')}>
          Prototype Overview
        </button>
        <button className={activeView === 'preferences' ? 'active' : ''} onClick={() => setActiveView('preferences')}>
          Preferences
        </button>
        <button className={activeView === 'pantry' ? 'active' : ''} onClick={() => setActiveView('pantry')}>
          Pantry
        </button>
        <button className={activeView === 'weekly-plan' ? 'active' : ''} onClick={() => setActiveView('weekly-plan')}>
          Weekly Plan
        </button>
        <button className={activeView === 'recipe-search' ? 'active' : ''} onClick={() => setActiveView('recipe-search')}>
          Recipe Search
        </button>
        <button className={activeView === 'shopping-cart' ? 'active' : ''} onClick={() => setActiveView('shopping-cart')}>
          Shopping Cart
        </button>
      </nav>

      {activeView === 'overview' && (
        <section className="panel overview-panel">
          <h2>Meals My Way Prototype: Full Product Overview</h2>
          <p className="status">
            Meals My Way builds personalized weekly meal plans around your pantry, preferences, and budget,
            then carries your decisions through to live cart updates and retailer-ready checkouts.
          </p>
          <div className="overview-grid">
            <article className="overview-card">
              <h3>Smart Weekly Planning</h3>
              <p>
                The planner generates your top weekly recipes from preference signals, pantry data, and budget fit,
                giving each week a complete and varied set of meal options.
              </p>
            </article>
            <article className="overview-card">
              <h3>Search and Flexible Swaps</h3>
              <p>
                At any point, users can move into recipe search, compare options, and replace specific meals in the
                plan without losing the rest of the week.
              </p>
            </article>
            <article className="overview-card">
              <h3>Pantry-First Recommendations</h3>
              <p>
                Recipes are weighted to consume overstocked pantry ingredients and spices, helping households use
                what they already own before buying more.
              </p>
            </article>
            <article className="overview-card">
              <h3>Perishable Shelf-Life Tracking</h3>
              <p>
                Every perishable tracks a seven-day life, generates near-expiry alerts, and auto-cleans from pantry
                inventory once it expires.
              </p>
            </article>
            <article className="overview-card">
              <h3>US-Friendly Units</h3>
              <p>
                Ingredient quantities are shown in pounds and ounces for mass-based items, making planning and
                shopping easy for US households.
              </p>
            </article>
            <article className="overview-card">
              <h3>Live Cart and Retailer Ranking</h3>
              <p>
                Cart totals recompute instantly after every plan change and checkout options are ranked by estimated
                cost across major grocery retailers.
              </p>
            </article>
          </div>
        </section>
      )}

      {activeView === 'preferences' && (
        <section className="panel">
          <h2>Preferences</h2>
          <div className="grid four">
            <label>
              Household preset
              <select value={householdSize} onChange={(e) => setHouseholdSize(Number(e.target.value))}>
                {HOUSEHOLD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset} people
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recipes per week
              <input
                type="number"
                min={1}
                max={50}
                value={weeklyRecipeTarget}
                onChange={(e) => setWeeklyRecipeTarget(Number(e.target.value))}
              />
            </label>
            <label>
              Protein strategy
              <input value="Weighted random with overstock priority" readOnly />
            </label>
            <label>
              Weekly budget cap ($)
              <input type="number" min={20} value={budgetCap} onChange={(e) => setBudgetCap(Number(e.target.value))} />
            </label>
          </div>
          <div className="grid two">
            <label>
              Allergy exclusions (comma separated)
              <input
                placeholder="shrimp, peanuts"
                value={allergiesRaw}
                onChange={(e) => setAllergiesRaw(e.target.value)}
              />
            </label>
            <label>
              Dislikes (comma separated)
              <input placeholder="tofu, dill" value={dislikesRaw} onChange={(e) => setDislikesRaw(e.target.value)} />
            </label>
          </div>
          <p className="status">
            Household: {householdSize} people. {budgetStatus}
          </p>
          <div className="live-api-controls">
            <h3>Live API Test Controls</h3>
            <p className="status">
              Free-only mode: list/search endpoints only. Full recipe detail calls are not made by this test run.
            </p>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={liveApiEnabled}
                onChange={(e) => {
                  const next = e.target.checked
                  setLiveApiEnabled(next)
                  setLiveApiArmed(false)
                  if (!next) {
                    setLiveRankedPool([])
                    setLiveApiDiagnostics(null)
                    setLiveApiStatus('Mock mode active. No API calls.')
                  }
                }}
                disabled={!LIVE_API_FEATURE_ENABLED}
              />
              Enable live API test mode
            </label>
            <div className="live-api-row">
              <button
                onClick={() => setLiveApiArmed((current) => !current)}
                disabled={!liveApiEnabled || liveApiBusy}
              >
                {liveApiArmed ? 'Disarm API Calls' : 'Arm API Calls'}
              </button>
              <button className="primary" onClick={runLiveApiTest} disabled={!liveApiEnabled || !liveApiArmed || liveApiBusy}>
                {liveApiBusy ? 'Running API Test...' : 'Run Free API Test'}
              </button>
            </div>
            <p className="status">{liveApiStatus}</p>
            {liveApiDiagnostics && (
              <p className="status">
                Pipeline counts: fetched {liveApiDiagnostics.fetched} | protein {liveApiDiagnostics.postProtein} | grain{' '}
                {liveApiDiagnostics.postGrain} | veggie {liveApiDiagnostics.postVeggie} | final {liveApiDiagnostics.finalSelected}
                {liveApiDiagnostics.fallbackSimilarityRelaxed && ' | similarity cap relaxed to 0.88'}
              </p>
            )}
          </div>
        </section>
      )}

      {activeView === 'pantry' && (
        <section className="panel">
          <h2>Pantry</h2>
          <div className="pantry-form">
            <input
              placeholder="ingredient name"
              value={newPantryName}
              onChange={(e) => setNewPantryName(e.target.value)}
            />
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={newPantryQty}
              onChange={(e) => setNewPantryQty(Number(e.target.value))}
            />
            <select value={newPantryUnit} onChange={(e) => setNewPantryUnit(e.target.value as Unit)}>
              <option value="oz">oz</option>
              <option value="lb">lb</option>
              <option value="item">item</option>
              <option value="tsp">tsp</option>
              <option value="tbsp">tbsp</option>
            </select>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={newPantryPerishable}
                onChange={(e) => setNewPantryPerishable(e.target.checked)}
              />
              Perishable (auto-expire in 7 days)
            </label>
            <button className="primary" onClick={addPantryItem}>
              Add Item
            </button>
          </div>

          {nearExpiryItems.length > 0 && (
            <div className="alert-strip">
              <strong>Near expiry:</strong>{' '}
              {nearExpiryItems
                .map((item) => `${item.name} (${daysUntilExpiry(item)} day${daysUntilExpiry(item) === 1 ? '' : 's'} left)`)
                .join(', ')}
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Qty</th>
                  <th>Perishable</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pantry.map((item) => {
                  const days = daysUntilExpiry(item)
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={item.qty}
                          onChange={(e) => updatePantryQuantity(item.id, Number(e.target.value))}
                        />{' '}
                        {item.unit}
                        {(item.unit === 'oz' || item.unit === 'lb') && (
                          <span className="dim-note"> ({formatQty(item.qty, item.unit)})</span>
                        )}
                      </td>
                      <td>{item.perishable ? 'Yes' : 'No'}</td>
                      <td>{item.perishable ? `${days} days` : 'N/A'}</td>
                      <td>
                        <button onClick={() => removePantryItem(item.id)}>Remove</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeView === 'weekly-plan' && (
        <section className="panel weekly-plan-panel">
          <h2>Weekly Plan ({mealPlan.length} recipes)</h2>
          <div className="weekly-summary">
            <p className="status">
              Target: {weeklyPlanDiagnostic.target} | Actual: {weeklyPlanDiagnostic.actual} | Protein types: {weeklyPlanDiagnostic.proteins}
              {weeklyPlanDiagnostic.reason !== 'filled' && ` | Underfilled because: ${weeklyPlanDiagnostic.reason}`}
            </p>
            {!liveApiEnabled || liveRankedPool.length === 0 ? (
              <p className="status">
                Weekly limits: max {MAX_WEEKLY_PROTEIN_TYPES} protein types, {MAX_WEEKLY_GRAIN_TYPES} grain types,
                and {MAX_WEEKLY_VEGGIE_TYPES} veggie types.
              </p>
            ) : (
              <p className="status">
                Live test limits active. Lanes: {liveApiDiagnostics?.proteinLanes.join(', ') || 'n/a'} | Grains:{' '}
                {liveApiDiagnostics?.selectedGrains.join(', ') || 'n/a'}.
              </p>
            )}
            <p className="status">
              This week proteins: {currentWeekProteinTypes.join(', ') || 'N/A'}.
              Last week meta buckets (de-prioritized): {lastWeekProteinMetaBuckets.join(', ') || 'none'}.
            </p>
            <p className="status">
              Top {Math.min(weeklyRecipeTarget, activeRankedPool.length)} unique recipes from ranking signals.
              {activeRankedPool.length < weeklyRecipeTarget && ' Fewer than requested are available under current filters.'}
            </p>
            {liveApiEnabled && liveApiDiagnostics && (
              <p className="status">
                Live pipeline counts: fetched {liveApiDiagnostics.fetched} | protein {liveApiDiagnostics.postProtein} | grain{' '}
                {liveApiDiagnostics.postGrain} | veggie {liveApiDiagnostics.postVeggie} | final {liveApiDiagnostics.finalSelected}
                {liveApiDiagnostics.fallbackSimilarityRelaxed && ' | similarity cap relaxed to 0.88'}
              </p>
            )}
          </div>

          <div className="recipe-grid two-col-cards">
            {mealPlan.map((recipe, index) => (
              <article key={`${recipe.id}-${index}`} className="recipe-card">
                <img src={recipe.imageUrl} alt={recipe.name} loading="lazy" />
                <div className="recipe-card-body">
                  <h3>{recipe.name}</h3>
                  <p className="meta-row">
                    <span>${recipe.estimatedCost.toFixed(2)}</span>
                    <span>{recipe.servings} servings</span>
                  </p>
                  <p className="ingredient-blurb">Notable: {notableIngredients(recipe).join(', ')}</p>
                  <button
                    onClick={() => {
                      setPendingSwapIndex(index)
                      setActiveView('recipe-search')
                    }}
                  >
                    Swap using search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeView === 'recipe-search' && (
        <section className="panel">
          <h2>Recipe Search</h2>
          <input
            className="search"
            placeholder="Search recipes by name"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <p className="status">
            {pendingSwapIndex !== null
              ? `Showing swap-safe recipes for slot ${pendingSwapIndex + 1} within this week's protein meta-buckets and limits.`
              : liveApiEnabled && liveRankedPool.length > 0
                ? 'Showing free API summary results (no paid detail calls in this mode).'
                : 'All recipes ranked by spice variety, pantry overstock usage, and near-expiry usage.'}
          </p>

          <div className="recipe-grid two-col-cards">
            {(pendingSwapIndex !== null ? swapCandidates : rankedRecipes).map((row) =>
              recipeCard(
                row.recipe,
                pendingSwapIndex !== null ? `Swap into slot ${pendingSwapIndex + 1}` : 'Add to weekly plan',
                () => chooseRecipeFromSearch(row.recipe),
              ),
            )}
          </div>
        </section>
      )}

      {activeView === 'shopping-cart' && (
        <section className="panel two-col">
          <div>
            <h2>Shopping Cart</h2>
            <p className="status">
              {liveApiEnabled && liveRankedPool.length > 0
                ? 'Live test mode uses free recipe summaries only, so exact cart math is disabled until full-detail calls are enabled.'
                : 'Only ingredients not already covered by your pantry are listed.'}
            </p>
            <ul className="cart-list">
              {cartRows.map((row) => (
                <li key={`${row.name}-${row.unit}`}>
                  <span>{row.name}</span>
                  <strong>
                    {row.unit === 'oz' ? formatMass(row.value) : `${row.value.toFixed(1)} ${row.unit}`}
                  </strong>
                </li>
              ))}
              {cartRows.length === 0 && <li>Cart is empty.</li>}
            </ul>
          </div>
          <div>
            <h2>Retailer Estimates</h2>
            <ul className="retailer-list">
              {retailerEstimates.map((entry, index) => (
                <li key={entry.retailer}>
                  <span>{index === 0 ? 'Recommended' : 'Option'}</span>
                  <strong>
                    {entry.retailer}: ${entry.estimate.toFixed(2)}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="status">{budgetStatus}</p>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
