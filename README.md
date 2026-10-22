# Timeline of Travels

A map of my explorations throughout the years: a 3D globe with a photo pin for each trip.

Built with [Next.js](https://nextjs.org) (App Router). Trips and photos are currently stored in the browser's IndexedDB.

## Development

```bash
npm install
npm run dev
```

Then open http://localhost:8000. The dev server uses port 8000 so trips saved in the browser (which are tied to the address) stay visible.

Other scripts:

- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint
