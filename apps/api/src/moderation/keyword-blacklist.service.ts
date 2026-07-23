import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { blockedKeywords } from '../db/schema';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * In-memory cache of the keyword blacklist. Screening runs on the chat hot path,
 * so it must not hit the database per message; the terms are loaded at boot and
 * refreshed on a timer, and admin edits refresh immediately.
 *
 * Matching is substring, case-insensitive, on a normalised form so common
 * evasions (extra spaces, mixed case) don't slip through. This is a backstop —
 * the paid-listing fee is the primary spam filter — not a content classifier.
 */
@Injectable()
export class KeywordBlacklistService implements OnModuleInit {
  private readonly logger = new Logger(KeywordBlacklistService.name);
  private terms: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
    // Do not keep the process alive solely for this timer.
    this.timer.unref?.();
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.db
        .select({ term: blockedKeywords.term })
        .from(blockedKeywords)
        .orderBy(asc(blockedKeywords.term));
      this.terms = rows.map((r) => normalise(r.term)).filter((t) => t.length > 0);
    } catch (error) {
      this.logger.error(`Failed to refresh keyword blacklist: ${String(error)}`);
    }
  }

  /** First matching term, or null if the text is clean. */
  firstMatch(text: string): string | null {
    const haystack = normalise(text);
    return this.terms.find((term) => haystack.includes(term)) ?? null;
  }

  async list() {
    return this.db.select().from(blockedKeywords).orderBy(asc(blockedKeywords.term));
  }

  async add(term: string): Promise<void> {
    const normalised = term.trim();
    if (normalised.length === 0) return;
    await this.db
      .insert(blockedKeywords)
      .values({ term: normalised })
      .onConflictDoNothing({ target: blockedKeywords.term });
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(blockedKeywords).where(eq(blockedKeywords.id, id));
    await this.refresh();
  }
}

/** Lowercase and collapse whitespace so trivial evasions still match. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
