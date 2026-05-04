import { bumpScriptTemplate, seed } from './seed/index';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
// --bump <slug>   Publish a new version (base + 1) of a specific template
//                 without touching existing rows. Useful during authoring.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const bumpIdx = args.indexOf('--bump');

async function main(): Promise<void> {
  if (bumpIdx !== -1) {
    const slug = args[bumpIdx + 1];
    if (!slug || slug.startsWith('--')) {
      console.error('Usage: pnpm db:seed --bump <slug>');
      process.exit(1);
    }
    console.warn(`Bumping template version for "${slug}"...`);
    await bumpScriptTemplate(slug);
    console.warn(`  ✓ "${slug}" bumped to new version`);
    return;
  }

  await seed();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
