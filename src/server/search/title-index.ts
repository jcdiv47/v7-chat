import { and, eq, isNull } from "drizzle-orm";
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
