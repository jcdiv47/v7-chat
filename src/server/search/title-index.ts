import { and, eq, inArray, isNull, like, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { searchTerms, threads } from "../db/schema";

type Dbx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const THREAD_TITLE_SOURCE = "thread_title" as const;

const MAX_TERMS = 64;
const HAN_RE = /\p{Script=Han}/u;
const WORD_RE = /[\p{Letter}\p{Number}]/u;

export function tokenizeTitleSearchText(value: string): string[] {
  const terms = new Set<string>();
  const normalized = value.normalize("NFKC").toLowerCase();
  let word = "";
  let han = "";

  const addWord = () => {
    if (word) terms.add(word);
    word = "";
  };

  const addHan = () => {
    if (!han) return;
    const chars = Array.from(han);
    for (const char of chars) terms.add(char);
    for (let i = 0; i < chars.length - 1; i += 1) {
      terms.add(`${chars[i]}${chars[i + 1]}`);
    }
    han = "";
  };

  for (const char of normalized) {
    if (HAN_RE.test(char)) {
      addWord();
      han += char;
    } else if (WORD_RE.test(char)) {
      addHan();
      word += char;
    } else {
      addWord();
      addHan();
    }
  }
  addWord();
  addHan();

  return Array.from(terms).slice(0, MAX_TERMS);
}

/** Escape LIKE wildcards so a token matches only as a literal prefix. Word
 * tokens are letters/numbers today (see WORD_RE) so this is defensive, but it
 * keeps the prefix safe if the tokenizer ever admits `%`, `_`, or `\`. */
const escapeLikePrefix = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/**
 * Build the `search_terms.term` predicate for a ⌘K query. Word tokens match as
 * prefixes so the palette narrows as you type ("dash" → "dashboard"); Han
 * uni/bigrams stay exact matches, since bigrams already are the search
 * granularity for CJK and prefix-matching them would double-count. Returns
 * undefined when the query yields no terms (caller should return no results).
 *
 * Prefix LIKEs are applied within a single user's rows (the caller ANDs
 * `userId`), so the existing `(user_id, term)` index bounds the scan; a
 * `text_pattern_ops` index would make the prefixes index-driven if per-user
 * term volume ever grows large.
 */
export function buildTitleTermMatch(query: string): SQL | undefined {
  const terms = tokenizeTitleSearchText(query);
  if (terms.length === 0) return undefined;

  const hanTerms = terms.filter((t) => HAN_RE.test(t));
  const wordTerms = terms.filter((t) => !HAN_RE.test(t));

  const clauses: SQL[] = [];
  if (hanTerms.length > 0) clauses.push(inArray(searchTerms.term, hanTerms));
  for (const term of wordTerms) {
    clauses.push(like(searchTerms.term, `${escapeLikePrefix(term)}%`));
  }
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export async function replaceThreadTitleSearchTerms(
  dbx: Dbx,
  values: { userId: string; threadId: string; title: string },
): Promise<void> {
  await dbx
    .delete(searchTerms)
    .where(
      and(
        eq(searchTerms.userId, values.userId),
        eq(searchTerms.sourceKind, THREAD_TITLE_SOURCE),
        eq(searchTerms.sourceId, values.threadId),
      ),
    );

  const terms = tokenizeTitleSearchText(values.title);
  if (terms.length === 0) return;

  const now = new Date();
  await dbx.insert(searchTerms).values(
    terms.map((term) => ({
      userId: values.userId,
      threadId: values.threadId,
      sourceKind: THREAD_TITLE_SOURCE,
      sourceId: values.threadId,
      term,
      createdAt: now,
    })),
  );
}

export async function backfillThreadTitleSearchTerms(dbx: Db): Promise<number> {
  const rows = await dbx
    .select({
      id: threads.id,
      userId: threads.userId,
      title: threads.title,
    })
    .from(threads)
    .leftJoin(
      searchTerms,
      and(
        eq(searchTerms.sourceKind, THREAD_TITLE_SOURCE),
        eq(searchTerms.sourceId, threads.id),
      ),
    )
    .where(isNull(searchTerms.term));

  for (const row of rows) {
    await replaceThreadTitleSearchTerms(dbx, {
      userId: row.userId,
      threadId: row.id,
      title: row.title,
    });
  }

  return rows.length;
}
