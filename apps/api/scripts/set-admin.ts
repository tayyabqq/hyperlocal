/* eslint-disable no-console */
import postgres from 'postgres';

/**
 * Grants (or revokes) admin on an account by phone number. Admin is deliberately
 * out-of-band — there is no self-serve path to it — so the first admin is set
 * here, by someone with database access.
 *
 *   npm run make-admin -- +971500000001          # grant
 *   npm run make-admin -- +971500000001 --revoke  # revoke
 *
 * The user must have logged in at least once (so the row exists).
 */
async function run(): Promise<void> {
  const phone = process.argv[2];
  const revoke = process.argv.includes('--revoke');
  if (!phone || !phone.startsWith('+')) {
    console.error('Usage: npm run make-admin -- +9715XXXXXXXX [--revoke]');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const client = postgres(url, { max: 1 });
  try {
    const rows = await client`
      UPDATE users SET is_admin = ${!revoke}
      WHERE phone_e164 = ${phone}
      RETURNING id, display_name, is_admin
    `;
    if (rows.length === 0) {
      console.error(`No user found for ${phone}. They must log in once first.`);
      process.exit(1);
    }
    const row = rows[0];
    console.log(`${row.display_name || '(no name)'} (${phone}) is_admin=${row.is_admin}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
