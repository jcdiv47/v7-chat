# Canonical query patterns

Malls per city (city-level grain):

```sql
select c.name as city_name,
       count(m.id) as mall_count
from cities c
left join malls m on m.city_id = c.id
group by c.name
order by mall_count desc;
```

Stores per mall, with city (mall-level grain):

```sql
select m.name as mall_name,
       c.name as city_name,
       count(s.id) as store_count
from malls m
join cities c on c.id = m.city_id
left join stores s on s.mall_id = m.id
group by m.name, c.name
order by store_count desc
limit 20;
```

Stores per city (city-level grain, join through malls):

```sql
select c.name as city_name,
       count(s.id) as store_count
from cities c
left join malls m on m.city_id = c.id
left join stores s on s.mall_id = m.id
group by c.name
order by store_count desc;
```

Malls with no stores (absence → left join + null check):

```sql
select m.name as mall_name, c.name as city_name
from malls m
join cities c on c.id = m.city_id
left join stores s on s.mall_id = m.id
where s.id is null
order by m.name;
```

Cities with no malls:

```sql
select c.name as city_name
from cities c
left join malls m on m.city_id = c.id
where m.id is null
order by c.name;
```
