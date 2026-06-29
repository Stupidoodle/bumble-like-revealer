// Conventional Commits, enforced in CI (and locally via the optional husky hook).
// feat -> minor, fix/perf -> patch, `!` or `BREAKING CHANGE:` -> major; other
// types (chore, docs, refactor, test, ci, build, style) ship no release.
export default {
  extends: ["@commitlint/config-conventional"],
};
