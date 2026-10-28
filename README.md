# Snapshot of main

Written by `.github/workflows/snapshot.yml` every hour when main has changed. Don't
edit this branch: each run replaces it with a single new commit.

- `SOURCE_SHA`: the commit on main that the parts hold.
- `PARTS`: the part files, in order.
- `SHA256`: the sha256 of the joined and decoded `main.tar.gz`.

To make a working copy without git (see AGENTS.md):

    cat part-* | base64 -d > main.tar.gz
    sha256sum main.tar.gz          # must equal the SHA256 file
    mkdir carehub && tar -xzf main.tar.gz -C carehub
