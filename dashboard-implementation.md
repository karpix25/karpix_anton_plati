# Dashboard Implementation Plan

## Goal
Build a multi-client management dashboard using Next.js and shadcn/ui, connected to the existing PostgreSQL backend.

## Tasks
- [x] **Task 1**: Initialize Next.js 14 (App Router) in `./ui` → Verify: `npm run dev` works.
- [x] **Task 2**: Install & Configure shadcn/ui base components (Button, Select, Card) → Verify: Demo page renders correctly.
- [x] **Task 3**: Create API Routes for `clients` and `references` → Verify: `curl localhost:3000/api/clients` returns data.
- [x] **Task 4**: Implement Global State for "Active Business Profile" → Verify: Switching profile updates the layout title.
- [x] **Task 5**: Build "Viral Reference Hub" with Client-side Filtering → Verify: List updates when profile changes.
- [x] **Task 6**: Add "Batch Generate" button linking to `batch_generator.py` → Verify: Script execution triggered via API.
- [ ] **Task 7**: Localize entire UI to Russian → Verify: All labels are in Russian. [/]
- [ ] **Task 8**: Enhance Visual Hierarchy and Background Contrast → Verify: Text is readable and design looks premium.
- [ ] **Task 9**: Improve Data Visualization (Cards) → Verify: User understands what an "Atomic Gene" is.

## Done When
- [ ] Web UI displays separated content libraries for at least 2 different business profiles.
- [ ] A batch of scripts can be generated for a specific business via a button click.

## Notes
- Use `lucide-react` for icons.
- Ensure the API layer in Next.js uses the same `.env` as the Python bot.
