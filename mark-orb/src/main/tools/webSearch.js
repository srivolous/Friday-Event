// Web search tool.
// Mark-L runs Gemini Grounded Search + a DuckDuckGo fallback in parallel; friday_jarvis
// uses langchain's DuckDuckGoSearchRun. We have no cloud LLM to "ground" against here,
// so we go straight to DDG's HTML endpoint (same source both repos already fall back to)
// and return structured {title, url, snippet} results for the local LLM to summarize.

export async function searchWeb({ query, max_results = 5 }) {
  if (!query || !String(query).trim()) throw new Error('query is required')

  const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarkOrb/1.0)' }
  })
  const html = await res.text()

  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const links = [...html.matchAll(linkRe)]
  const snippets = [...html.matchAll(snippetRe)]

  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const results = []
  for (let i = 0; i < links.length && results.length < max_results; i++) {
    let url = links[i][1]
    const uddg = url.match(/uddg=([^&]+)/)
    if (uddg) url = decodeURIComponent(uddg[1])
    results.push({
      title: strip(links[i][2]),
      url,
      snippet: strip(snippets[i]?.[1] || '')
    })
  }
  return { query, results }
}
