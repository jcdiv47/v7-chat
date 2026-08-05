# Canonical query patterns

Tables are in the `aiqa` schema; always qualify. Cities join to malls **by
name** (`m.city = c.city`); stores join to malls by id (`s.mall_id = m.id`).

Malls per city (city-level grain, all statuses):

```sql
select c.city,
       count(m.id) as mall_count
from aiqa.cities c
left join aiqa.malls m on m.city = c.city
group by c.city
order by mall_count desc;
```

Stores per mall, with city (mall-level grain):

```sql
select m.name as mall_name,
       m.city,
       count(s.id) as store_count
from aiqa.malls m
left join aiqa.stores s on s.mall_id = m.id
group by m.id, m.name, m.city
order by store_count desc
limit 20;
```

Stores per city (city-level grain, join through malls):

```sql
select c.city,
       count(s.id) as store_count
from aiqa.cities c
left join aiqa.malls m on m.city = c.city
left join aiqa.stores s on s.mall_id = m.id
group by c.city
order by store_count desc;
```

Currently-open variant — filter both levels and say so in the answer:

```sql
select c.city,
       count(s.id) as open_store_count
from aiqa.cities c
left join aiqa.malls m
  on m.city = c.city and m.status in ('INITIAL', 'OPEN', 'REMODELLING_OPEN')
left join aiqa.stores s
  on s.mall_id = m.id and s.status in ('INITIAL', 'OPEN', 'REMODELLING_OPEN')
group by c.city
order by open_store_count desc;
```

Brand count in a city (e.g. "How many Starbucks in Shanghai?"):

```sql
select count(*) as store_count
from aiqa.stores s
join aiqa.malls m on m.id = s.mall_id
where m.city = '上海市'
  and (s.brand_name_cn like '%星巴克%' or s.brand_name ilike '%starbucks%')
  and s.status in ('INITIAL', 'OPEN', 'REMODELLING_OPEN');
```

Malls with no stores (absence → left join + null check):

```sql
select m.name as mall_name, m.city
from aiqa.malls m
left join aiqa.stores s on s.mall_id = m.id
where s.id is null
order by m.city, m.name;
```

Cities with no malls:

```sql
select c.city
from aiqa.cities c
left join aiqa.malls m on m.city = c.city
where m.id is null
order by c.city;
```

Openings over time (trend via open_date; there is no revenue time series):

```sql
select date_trunc('year', s.open_date)::date as opened_year,
       count(*) as stores_opened
from aiqa.stores s
where s.open_date is not null
group by 1
order by 1;
```

City-name join validation — malls whose `city` has no `cities` row (0 as of
2026-07-04; re-run if per-city totals look off):

```sql
select m.city, count(*) as orphan_malls
from aiqa.malls m
left join aiqa.cities c on c.city = m.city
where c.city is null
group by m.city
order by orphan_malls desc;
```
