# MICF Insights — TODO

## Performance
- [x] Virtual scrolling — only render visible table rows
- [x] Web Worker filtering — offload filter/sort to a background thread
- [x] Service Worker — offline support, instant reload from cache

## UI/UX
- [ ] Dark mode — toggle between light/dark themes
- [ ] Mobile responsive layout — card view for small screens
- [ ] Saved filter presets — named filter combos to localStorage
- [ ] Show favorites/bookmarks — star shows and filter to your list
- [ ] Multi-sort — sort by multiple columns
- [ ] Drag-to-reorder columns
- [ ] Detail panel improvements — mini-map for venue, ticket purchase link

## Data & Backend
- [ ] Incremental scraping — only scrape shows that changed
- [ ] Price data — add a price column if the API exposes it
- [ ] Show descriptions — scrape description text from detail pages
- [ ] Reviews/ratings — scrape review scores if available
- [ ] Historical data — track sold out progression over time

## Infrastructure
- [ ] Edge deployment — Fly.io or Cloudflare Workers with Litestream/LiteFS
- [ ] Push notifications — alert when a favorited show changes status
- [ ] API versioning — expose a REST API for other clients
- [ ] Health check endpoint — `/health` for monitoring
