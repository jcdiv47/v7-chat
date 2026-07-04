/**
 * Sample cities / malls / stores dataset. Used to seed the offline pglite dev
 * database (TUI / evals) and by `scripts/seed-db.ts` to seed a real Postgres for
 * local testing. Deliberately includes an empty mall and a mall-less city so the
 * "missing data" eval prompts have something to find.
 */

export const SCHEMA_SQL = `
create table if not exists cities (
  id          integer primary key,
  name        text not null,
  state       text not null,
  population  integer
);

create table if not exists malls (
  id          integer primary key,
  name        text not null,
  city_id     integer not null references cities(id),
  opened_year integer
);

create table if not exists stores (
  id          integer primary key,
  name        text not null,
  mall_id     integer not null references malls(id),
  category    text
);
`;

export const DATA_SQL = `
insert into cities (id, name, state, population) values
  (1, 'Seattle', 'WA', 749256),
  (2, 'Portland', 'OR', 652503),
  (3, 'San Francisco', 'CA', 808437),
  (4, 'Austin', 'TX', 961855),
  (5, 'Denver', 'CO', 715522),
  (6, 'Boise', 'ID', 235684)          -- city with no malls (missing-data eval)
on conflict (id) do nothing;

insert into malls (id, name, city_id, opened_year) values
  (1,  'Pike Place Galleria',    1, 1998),
  (2,  'Rainier Square Mall',    1, 2005),
  (3,  'Emerald Commons',        1, 2015),
  (4,  'Willamette Center',      2, 2001),
  (5,  'Rose City Mall',         2, 2010),
  (6,  'Bay View Shops',         3, 1995),
  (7,  'Golden Gate Plaza',      3, 2008),
  (8,  'Presidio Market',        3, 2019),
  (9,  'Congress Commons',       4, 2012),
  (10, 'Barton Creek Mall',      4, 1999),
  (11, 'Lady Bird Center',       4, 2021),
  (12, 'Mile High Mall',         5, 2003),
  (13, 'Cherry Creek Shops',     5, 2016),
  (14, 'Union Station Market',   5, 2022)   -- empty mall (missing-data eval)
on conflict (id) do nothing;

insert into stores (id, name, mall_id, category) values
  (1,  'Cascade Coffee',        1, 'Food & Beverage'),
  (2,  'Summit Outfitters',     1, 'Apparel'),
  (3,  'Pike Books',            1, 'Books'),
  (4,  'Northwest Threads',     2, 'Apparel'),
  (5,  'Rainier Electronics',   2, 'Electronics'),
  (6,  'Sound Cellular',        2, 'Electronics'),
  (7,  'Evergreen Grocer',      2, 'Grocery'),
  (8,  'Emerald Toys',          3, 'Toys'),
  (9,  'Commons Cafe',          3, 'Food & Beverage'),
  (10, 'Willamette Wearhouse',  4, 'Apparel'),
  (11, 'Bridgetown Books',      4, 'Books'),
  (12, 'Rose City Roasters',    5, 'Food & Beverage'),
  (13, 'Portland Pet Supply',   5, 'Pets'),
  (14, 'Rose Apparel Co',       5, 'Apparel'),
  (15, 'Bay View Books',        6, 'Books'),
  (16, 'Pacific Apparel',       6, 'Apparel'),
  (17, 'Fog City Electronics',  6, 'Electronics'),
  (18, 'Golden Gate Grocer',    7, 'Grocery'),
  (19, 'Plaza Pharmacy',        7, 'Health'),
  (20, 'GG Toys',               7, 'Toys'),
  (21, 'Bridge Cafe',           7, 'Food & Beverage'),
  (22, 'Presidio Provisions',   8, 'Grocery'),
  (23, 'Congress Coffee',       9, 'Food & Beverage'),
  (24, 'Capitol Apparel',       9, 'Apparel'),
  (25, 'Congress Comics',       9, 'Books'),
  (26, 'Barton Books',          10, 'Books'),
  (27, 'Creek Outfitters',      10, 'Apparel'),
  (28, 'Hill Country Grocer',   10, 'Grocery'),
  (29, 'Barton Electronics',    10, 'Electronics'),
  (30, 'Lady Bird Cafe',        11, 'Food & Beverage'),
  (31, 'Bird Boutique',         11, 'Apparel'),
  (32, 'Mile High Coffee',      12, 'Food & Beverage'),
  (33, 'Rocky Mtn Outfitters',  12, 'Apparel'),
  (34, 'Denver Electronics',    12, 'Electronics'),
  (35, 'Cherry Creek Cafe',     13, 'Food & Beverage'),
  (36, 'Creek Books',           13, 'Books'),
  (37, 'Creek Apparel',         13, 'Apparel'),
  (38, 'Creek Toys',            13, 'Toys')
on conflict (id) do nothing;
`;

/** Ordered list of statements for engines that run one statement per call. */
export function seedStatements(): string[] {
  return [
    ...SCHEMA_SQL.split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    ...DATA_SQL.split(";")
      .map((s) =>
        s
          .split("\n")
          .map((line) => line.replace(/\s+--.*$/, ""))
          .join("\n")
          .trim(),
      )
      .filter(Boolean),
  ];
}
