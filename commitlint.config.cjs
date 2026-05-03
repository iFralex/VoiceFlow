/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow task(<plan-id>) scopes like task(01), task(02), etc.
    // Disable scope-enum to permit any scope value
    'scope-enum': [0],
    // Allow parentheses in scope names (e.g. task(01))
    'scope-case': [0],
  },
};
