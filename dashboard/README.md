# Management Dashboard: Viral Content Factory

This dashboard allows you to manage your reference library and generate mass content.

## Components

1. **Reference Hub**: Browse all Reels sent via Telegram.
2. **Batch Factory**: Select a client and generate N scripts.
3. **Execution Center**: Track HeyGen/Video performance.

## Tech Stack (Planned)
- **Frontend**: Next.js (shadcn/ui)
- **Backend**: Python FastAPI (existing services)
- **Database**: PostgreSQL (shared with Bot)

## How to Scale
1. Collect 20+ references via Telegram per niche.
2. Filter by `viral_score > 80`.
3. Use `batch_generator.py` to create a content plan for a month in 5 minutes.
