/**
 * Stands in for `react-devtools-core`, which Ink imports but only ever calls
 * when `DEV=true`.
 *
 * It is an optional peer dependency: nobody installs it, and Ink works
 * perfectly without it. But the import is static, so a bundler follows it
 * anyway and fails on a package that was never meant to be there. Aliasing it
 * to this keeps the reference resolvable and the devtools path unreachable,
 * which is what running it without devtools already meant.
 */
export function connectToDevTools(): void {}

export default { connectToDevTools }
