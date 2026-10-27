# Care Hub

A private workspace for a Customer Care team: pages and databases, messages, a calendar, meetings, learning (courses and quizzes) and an optional Claude assistant. It runs on one small server with Docker.

This is a clean-room rebuild, written from scratch from the plan in [`docs/plan/`](docs/plan/README.md). No code comes from AppFlowy or the old Care Hub.

- **Status:** see [`docs/STATUS.md`](docs/STATUS.md)
- **Rules for builders (people and agents):** [`AGENTS.md`](AGENTS.md)
- **Decisions:** [`docs/decisions/`](docs/decisions/)
- **Data:** fictional data only until approved otherwise.

Private repository. Copyright © 2026 Felipe Gonçalves. All rights reserved. See [LICENSE](LICENSE).

## Deploy

Care Hub runs on one server with Docker Compose, reachable only over Tailscale. The server builds the image itself from a version that passed CI on `main`; nothing is published. [`deploy/README.md`](deploy/README.md) has the prerequisites, the first start and health check, updates and rollbacks, backups and restores, and where the data lives. A person or an AI assistant can follow it step by step.
