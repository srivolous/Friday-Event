// Weather tool.
// friday_jarvis's get_weather() hit wttr.in and returned raw text ("City: +15C").
// We hit the same free, key-less endpoint but ask for structured JSON (format=j1)
// so the LLM gets clean fields instead of having to parse prose.

export async function getWeather({ city }) {
  if (!city || !String(city).trim()) throw new Error('city is required')

  const res = await fetch(`https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`, {
    headers: { 'User-Agent': 'curl/8.0' } // wttr.in serves ANSI art to browser-like UAs; curl UA gets JSON cleanly
  })
  if (!res.ok) throw new Error(`weather lookup failed (${res.status})`)

  const data = await res.json()
  const cur = data.current_condition?.[0]
  const area = data.nearest_area?.[0]
  if (!cur) throw new Error(`no weather data for "${city}"`)

  return {
    location: [area?.areaName?.[0]?.value, area?.country?.[0]?.value].filter(Boolean).join(', ') || city,
    temperature_c: Number(cur.temp_C),
    feels_like_c: Number(cur.FeelsLikeC),
    condition: cur.weatherDesc?.[0]?.value,
    humidity_pct: Number(cur.humidity),
    wind_kmph: Number(cur.windspeedKmph)
  }
}
