#!/usr/bin/env bash
# Every fork branch that carries its own commits and is merged into `deploy` must be named
# in deploy.sh's BRANCHES. `./deploy.sh update` rebuilds deploy from that list, so a branch
# missing from it is silently dropped on the next rebuild.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

declared=$(sed -n 's/^BRANCHES=(\(.*\))$/\1/p' deploy.sh)
if [ -z "$declared" ]; then
  echo "could not read BRANCHES from deploy.sh"
  exit 2
fi

checked=0
missing=0
for ref in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin | sed 's#^origin/##' | sort -u); do
  case "$ref" in main | deploy | HEAD | origin) continue ;; esac
  tip=$(git rev-parse -q --verify "refs/heads/$ref" || git rev-parse -q --verify "refs/remotes/origin/$ref") || continue
  # no commits of its own (a mirror of main) -> nothing to carry
  [ "$(git rev-list --count "origin/main..$tip")" -gt 0 ] || continue
  # not merged into deploy -> deploy does not depend on it
  git merge-base --is-ancestor "$tip" deploy || continue
  checked=$((checked + 1))
  case " $declared " in
    *" $ref "*) ;;
    *)
      echo "MISSING from BRANCHES: $ref"
      missing=$((missing + 1))
      ;;
  esac
done

echo "branches merged into deploy: $checked, missing from BRANCHES: $missing"
[ "$missing" -eq 0 ]
