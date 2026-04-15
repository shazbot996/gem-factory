import crypto from 'node:crypto';
import * as gems from '../db/gems.js';
import * as users from '../db/users.js';

function normalize(text) {
  return text
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function importGems(pool, { userId, gemsPayload }) {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const importedIds = [];

  for (const gem of gemsPayload) {
    const normalizedInstructions = normalize(gem.instructions);
    const instructionHash = hash(normalizedInstructions);

    const row = await gems.insertGem(pool, {
      ownerId: userId,
      name: gem.name,
      description: gem.description,
      instructions: normalizedInstructions,
      icon: gem.icon,
      source: gem.source || 'extension',
      instructionHash,
      geminiId: gem.geminiId,
      knowledgeFiles: gem.knowledgeFiles,
      defaultTools: gem.defaultTools,
      extractedAt: gem.extractedAt,
    });

    if (row) {
      if (row.inserted) {
        imported++;
        importedIds.push(row.id);
      } else {
        // ON CONFLICT DO UPDATE — gem existed, was refreshed
        updated++;
        importedIds.push(row.id);
      }
    } else {
      skipped++;
    }
  }

  if (imported > 0 || updated > 0) {
    await users.updateLastImport(pool, userId);
  }

  return { imported, updated, skipped, importedIds };
}

// Exported for testing
export { normalize, hash };
