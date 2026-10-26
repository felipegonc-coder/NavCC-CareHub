#!/usr/bin/env bash
# Publishes screenshots to <folder>/ on the ci-screenshots branch and prints the new commit SHA.
# The branch has a single commit without parents: each push replaces <folder>/ and keeps the
# other folders. Only git objects are written, so the checked-out code is not touched.
# Usage: bash tests/e2e/ci/push-screenshots.sh <folder> <file>...
set -euo pipefail
folder=$1
shift
branch=${SCREENSHOT_BRANCH:-ci-screenshots}
export GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-github-actions[bot]}
export GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL

files=$(for file in "$@"; do printf '100644 blob %s\t%s\n' "$(git hash-object -w "$file")" "$(basename "$file")"; done | git mktree)
for attempt in 1 2 3; do
  old='' others=''
  if git fetch --quiet --depth=1 origin "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null; then
    old=$(git rev-parse "refs/remotes/origin/$branch")
    others=$(git ls-tree "$old" | awk -F '\t' -v folder="$folder" '$2 != folder')
  fi # else the branch does not exist yet
  tree=$(printf '%s\n040000 tree %s\t%s\n' "$others" "$files" "$folder" | sed '/^$/d' | git mktree)
  commit=$(git commit-tree "$tree" -m "Screenshots for $folder")
  if git push --quiet --force-with-lease="refs/heads/$branch:$old" origin "$commit:refs/heads/$branch"; then
    echo "$commit"
    exit 0
  fi
  echo "Pushing to $branch failed (attempt $attempt of 3)." >&2
  sleep $((attempt * 3))
done
exit 1
