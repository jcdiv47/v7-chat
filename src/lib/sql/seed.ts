/**
 * Sample cities / malls / stores dataset mirroring the live `aiqa` schema
 * (Chinese mall/retail data; see agent-skills/business-domain-analysis/references/
 * schema.md). Used to seed the offline pglite dev database (TUI / evals) and by
 * `scripts/seed-db.ts` to seed a real Postgres for local testing. Deliberately
 * includes an empty mall (北京新集市广场), a mall-less city (三沙市), and closed
 * malls/stores so the "missing data" and status-filter eval prompts have
 * something to find.
 */

export const SCHEMA_SQL = `
create schema if not exists aiqa;

create table if not exists aiqa.cities (
  city       text primary key,
  province   text not null,
  city_tier  text not null,
  region     text not null
);

create table if not exists aiqa.malls (
  id                    text primary key,
  name                  text not null,
  district              text not null,
  city                  text not null references aiqa.cities(city),
  province              text not null,
  address               text not null,
  status                text not null,
  open_date             date,
  real_estate_developer text,
  market_positioning    text,
  rank                  text,
  shopping_area         text,
  shopping_area_rank    text,
  area                  numeric,
  close_date            date
);

create table if not exists aiqa.stores (
  id            text primary key,
  sku           text not null,
  brand_name    text not null,
  brand_name_cn text not null,
  category      text not null,
  category_cn   text not null,
  mall_id       text not null references aiqa.malls(id),
  status        text not null,
  floor         text,
  open_date     date,
  close_date    date,
  area          numeric
);
`;

export const DATA_SQL = `
insert into aiqa.cities (city, province, city_tier, region) values
  ('上海市',   '上海市',   '一线', '华东地区'),
  ('北京市',   '北京市',   '一线', '华北地区'),
  ('深圳市',   '广东省',   '一线', '华南地区'),
  ('沈阳市',   '辽宁省',   '二线', '东北地区'),
  ('佳木斯市', '黑龙江省', '五线', '东北地区'),
  ('三沙市',   '海南省',   '五线', '华南地区')   -- city with no malls (missing-data eval)
on conflict (city) do nothing;

insert into aiqa.malls
  (id, name, district, city, province, address, status, open_date,
   real_estate_developer, market_positioning, rank, shopping_area,
   shopping_area_rank, area, close_date) values
  ('GrandJoy-v-CHN-1', '上海大悦城',       '静安区',   '上海市',   '上海市',   '西藏北路198号',   'OPEN',    '2010-12-01', '中粮集团',   '中端', 'District Leader',  '苏河湾', 'A',  120000, null),
  ('PlazaOne-v-CHN-2', '上海一方城',       '浦东新区', '上海市',   '上海市',   '世纪大道100号',   'OPEN',    '2016-05-20', '陆家嘴集团', '高端', null,               '陆家嘴', 'S',  98000,  null),
  ('OldBlock-v-CHN-3', '上海老街坊商城',   '黄浦区',   '上海市',   '上海市',   '河南南路33号',    'CLOSED',  '1998-03-15', null,         '平价', null,               null,     null, 25000,  '2020-06-30'),
  ('JoyCity-v-CHN-4',  '北京朝阳大悦城',   '朝阳区',   '北京市',   '北京市',   '朝阳北路101号',   'OPEN',    '2010-05-01', '中粮集团',   '中端', 'Community Leader', '青年路', 'B',  110000, null),
  ('XiDanJoy-v-CHN-5', '北京西单大悦城',   '西城区',   '北京市',   '北京市',   '西单北大街131号', 'OPEN',    '2007-12-20', '中粮集团',   '中端', null,               '西单',   'A',  105000, null),
  ('NewMart-v-CHN-6',  '北京新集市广场',   '海淀区',   '北京市',   '北京市',   '学院路15号',      'OPEN',    '2021-09-30', null,         '个体', null,               null,     null, 18000,  null),  -- empty mall (missing-data eval)
  ('SeaWorld-v-CHN-7', '深圳海上世界',     '南山区',   '深圳市',   '广东省',   '望海路1128号',    'OPEN',    '2013-08-08', '招商蛇口',   '高端', 'Destination',      '蛇口',   'A',  90000,  null),
  ('MidStreet-v-CHN-8','沈阳中街商城',     '沈河区',   '沈阳市',   '辽宁省',   '中街路128号',     'INITIAL', '2005-11-25', null,         '个体', null,               null,     null, 22000,  null),
  ('RiverSide-v-CHN-9','佳木斯江畔购物中心','前进区',  '佳木斯市', '黑龙江省', '中山路77号',      'OPEN',    '2018-01-01', null,         '平价', null,               null,     null, 30000,  null)
on conflict (id) do nothing;

insert into aiqa.stores
  (id, sku, brand_name, brand_name_cn, category, category_cn, mall_id, status,
   floor, open_date, close_date, area) values
  ('StarBucks-s-CHN-1',   'StarBucks-s',   'STARBUCKS',     '星巴克',     'F&B',                        '餐饮美食',   'GrandJoy-v-CHN-1',  'OPEN',    'L1', '2011-01-15', null,         220),
  ('UniQlo-s-CHN-1',      'UniQlo-s',      'UNIQLO',        '优衣库',     'Men and Women''s Clothing',  '男女装',     'GrandJoy-v-CHN-1',  'OPEN',    'L3', '2011-03-01', null,         850),
  ('LiNing-s-CHN-1',      'LiNing-s',      'LI-NING',       '李宁',       'Sport',                      '运动户外',   'GrandJoy-v-CHN-1',  'OPEN',    'L4', '2015-08-01', null,         310),
  ('ChowTaiFook-s-CHN-1', 'ChowTaiFook-s', 'CHOW TAI FOOK', '周大福',     'Jewellery Watches Gifts',    '珠宝饰品',   'GrandJoy-v-CHN-1',  'OPEN',    'L1', '2011-01-15', null,         120),
  ('HaiDiLao-s-CHN-1',    'HaiDiLao-s',    'HAIDILAO',      '海底捞',     'F&B',                        '餐饮美食',   'GrandJoy-v-CHN-1',  'OPEN',    'L6', '2017-06-18', null,         900),
  ('EstLauder-s-CHN-1',   'EstLauder-s',   'ESTEE LAUDER',  '雅诗兰黛',   'Beauty',                     '护肤化妆品', 'GrandJoy-v-CHN-1',  'CLOSED',  'L1', '2012-09-01', '2023-04-30', 95),
  ('StarBucks-s-CHN-2',   'StarBucks-s',   'STARBUCKS',     '星巴克',     'F&B',                        '餐饮美食',   'PlazaOne-v-CHN-2',  'OPEN',    'L1', '2016-06-01', null,         200),
  ('Nike-s-CHN-1',        'Nike-s',        'NIKE',          '耐克',       'Sport',                      '运动户外',   'PlazaOne-v-CHN-2',  'OPEN',    'L2', '2016-05-20', null,         420),
  ('Belle-s-CHN-1',       'Belle-s',       'BELLE',         '百丽',       'Shoes',                      '鞋',         'PlazaOne-v-CHN-2',  'OPEN',    'L2', '2016-05-20', null,         180),
  ('Only-s-CHN-1',        'Only-s',        'ONLY',          'ONLY',       'Women''s Clothing',          '女装',       'PlazaOne-v-CHN-2',  'OPEN',    'L3', '2018-11-11', null,         160),
  ('Gome-s-CHN-1',        'Gome-s',        'GOME',          '国美电器',   'Electronics & Appliance',    '数码电器',   'OldBlock-v-CHN-3',  'CLOSED',  'L2', '1999-04-10', '2020-06-30', 1500),
  ('YongHeKing-s-CHN-1',  'YongHeKing-s',  'YONGHE KING',   '永和大王',   'F&B',                        '餐饮美食',   'OldBlock-v-CHN-3',  'CLOSED',  'L1', '2001-02-01', '2020-06-30', 260),
  ('StarBucks-s-CHN-3',   'StarBucks-s',   'STARBUCKS',     '星巴克',     'F&B',                        '餐饮美食',   'JoyCity-v-CHN-4',   'OPEN',    'L1', '2010-06-01', null,         210),
  ('UniQlo-s-CHN-2',      'UniQlo-s',      'UNIQLO',        '优衣库',     'Men and Women''s Clothing',  '男女装',     'JoyCity-v-CHN-4',   'OPEN',    'L2', '2010-05-01', null,         780),
  ('LiNing-s-CHN-2',      'LiNing-s',      'LI-NING',       '李宁',       'Sport',                      '运动户外',   'JoyCity-v-CHN-4',   'OPEN',    'L5', '2019-09-01', null,         290),
  ('BalaBala-s-CHN-1',    'BalaBala-s',    'BALABALA',      '巴拉巴拉',   'Children, Maternity & Baby', '母婴儿童',   'JoyCity-v-CHN-4',   'OPEN',    'L4', '2014-03-08', null,         240),
  ('XiaoMi-s-CHN-1',      'XiaoMi-s',      'XIAOMI',        '小米之家',   'Electronics & Appliance',    '数码电器',   'JoyCity-v-CHN-4',   'OPEN',    'L3', '2018-04-03', null,         200),
  ('StarBucks-s-CHN-4',   'StarBucks-s',   'STARBUCKS',     '星巴克',     'F&B',                        '餐饮美食',   'XiDanJoy-v-CHN-5',  'OPEN',    'B1', '2008-01-20', null,         190),
  ('Hla-s-CHN-1',         'Hla-s',         'HLA',           '海澜之家',   'Men''s Clothing',            '男装',       'XiDanJoy-v-CHN-5',  'OPEN',    'L2', '2013-10-01', null,         350),
  ('StarBucks-s-CHN-5',   'StarBucks-s',   'STARBUCKS',     '星巴克',     'F&B',                        '餐饮美食',   'SeaWorld-v-CHN-7',  'OPEN',    'L1', '2013-08-08', null,         230),
  ('ChowTaiFook-s-CHN-2', 'ChowTaiFook-s', 'CHOW TAI FOOK', '周大福',     'Jewellery Watches Gifts',    '珠宝饰品',   'SeaWorld-v-CHN-7',  'OPEN',    'L1', '2013-08-08', null,         110),
  ('HaiDiLao-s-CHN-2',    'HaiDiLao-s',    'HAIDILAO',      '海底捞',     'F&B',                        '餐饮美食',   'SeaWorld-v-CHN-7',  'PLANNED', null, null,         null,         null),
  ('Anta-s-CHN-1',        'Anta-s',        'ANTA',          '安踏',       'Sport',                      '运动户外',   'SeaWorld-v-CHN-7',  'OPEN',    'L2', '2015-07-01', null,         260),
  ('LiNing-s-CHN-3',      'LiNing-s',      'LI-NING',       '李宁',       'Sport',                      '运动户外',   'MidStreet-v-CHN-8', 'INITIAL', null, '2006-05-01', null,         null),
  ('Belle-s-CHN-2',       'Belle-s',       'BELLE',         '百丽',       'Shoes',                      '鞋',         'MidStreet-v-CHN-8', 'CLOSED',  'L1', '2006-05-01', '2019-05-31', 150),
  ('Anta-s-CHN-2',        'Anta-s',        'ANTA',          '安踏',       'Sport',                      '运动户外',   'RiverSide-v-CHN-9', 'OPEN',    'L1', '2018-01-01', null,         220)
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
