// Stands in for the frame server inside the static preview: the run list
// comes from data/runs.json, writes are refused, and no change events come.
"use strict"
;(() => {
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url
    if (url.startsWith("/api/runs")) return real("data/runs.json", { cache: "no-store" })
    if (url.startsWith("/api/")) {
      const body = JSON.stringify({ error: "preview: read only" })
      return Promise.resolve(new Response(body, { status: 405, headers: { "content-type": "application/json" } }))
    }
    return real(input, init)
  }
  window.EventSource = class {
    addEventListener() {}
    close() {}
  }
})()
