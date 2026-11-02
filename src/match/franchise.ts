import { FRANCHISE_BRANDS } from '../data/franchiseBrands.js'
import { normName, domainFromUrl } from '../core/normalize.js'

export interface Brand { brand: string; kind: string; aliases: string[]; domains: string[] }

let brands: Brand[] | null = null
export function loadBrands(): Brand[] {
  if (brands) return brands
  brands = FRANCHISE_BRANDS.map((r) => ({
    brand: r.brand,
    kind: r.kind,
    aliases: (r.aliases || r.brand).split('|').map((a) => normName(a)).filter(Boolean),
    domains: (r.domains || '').split('|').map((d) => d.trim().toLowerCase()).filter(Boolean),
  }))
  return brands
}

/** Domains shared by many offices of one chain, so a website match alone does not mean same office. */
export function sharedDomains(): Set<string> {
  return new Set(loadBrands().flatMap((b) => b.domains))
}

/** The brand whose name or website this business uses, if any. */
export function detectBrand(names: string[], websites: string[]): Brand | undefined {
  const doms = websites.map(domainFromUrl).filter(Boolean)
  for (const b of loadBrands()) {
    if (doms.some((d) => b.domains.some((bd) => d === bd || d.endsWith(`.${bd}`)))) return b
  }
  for (const b of loadBrands()) {
    for (const n of names) {
      const nn = ` ${normName(n)} `
      if (b.aliases.some((a) => nn.includes(` ${a} `))) return b
    }
  }
  return undefined
}
