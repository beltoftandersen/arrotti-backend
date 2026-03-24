-- =============================================================================
-- Create import_product_v2 table
--
-- Combines partslink_product (reference catalog) with ksi_product (supplier data).
-- Unlike the original import_product which only included products with KSI matches,
-- this version includes ALL partslink products. Products without KSI data are
-- flagged as is_quote_only = true (no price available, must request a quote).
--
-- KSI variants: KSI sells the same base partslink as multiple SKUs when
-- certifications differ. e.g. AC1000133 (standard) and AC1000133C (CAPA).
-- ksi_product.base_link_no = partslink base, ksi_product.link_suffix = C/N/P/null.
--
-- Run: sudo -u postgres psql -d ksi_data -f /root/my-medusa-store/src/scripts/sql/create-import-table.sql
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS import_product_v2;

CREATE TABLE import_product_v2 AS
SELECT
  -- Base partslink (groups variants into one Medusa product)
  pp.plink                              AS base_plink,
  -- Full plink including suffix (becomes variant SKU)
  COALESCE(kp.link_no, pp.plink)        AS plink,
  -- Suffix: C=CAPA, N=NSF, P=Steel, null=Standard
  kp.link_suffix                        AS link_suffix,

  -- Product info (from partslink reference)
  pp.pname,
  pp.ptype,
  pt.ctype,

  -- Fitment (from partslink - one row per vehicle/variable combo)
  pp.make,
  pp.model,
  pp.y1,
  pp.y2,
  pp.variables,
  pp.notes,
  (pp.notes IS NOT NULL AND pp.notes != '')::boolean AS has_notes,

  -- Part identifiers
  pp.oem,
  pp.long_oem,
  -- hollander from KSI if available, otherwise null
  kp.hollander_no,
  pp.supersede,
  pp.cert,
  pp.status       AS pl_status,
  pp.origin,
  pp.neworreblt,

  -- KSI supplier data (null if not in KSI catalog)
  kp.price        AS cost_price,
  kp.ksi_no,
  kp.qty          AS ksi_qty,
  (kp.ksi_no IS NOT NULL)::boolean AS has_ksi,

  -- Quote-only flag: true when no KSI supplier has this product
  (kp.ksi_no IS NULL)::boolean AS is_quote_only,

  -- Partslink reference ID
  pp.partslink_id

FROM partslink_product pp

-- Join ptype lookup to get ctype (category type)
JOIN partslink_ptype pt ON pt.ptype = pp.ptype

-- LEFT join KSI: base partslink matches KSI base_link_no
-- This gives us all KSI variants (standard + CAPA/NSF/etc) for each partslink
LEFT JOIN ksi_product kp ON kp.base_link_no = pp.plink

ORDER BY base_plink, link_suffix NULLS FIRST;

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX idx_ipv2_base_plink ON import_product_v2 (base_plink);
CREATE INDEX idx_ipv2_plink ON import_product_v2 (plink);
CREATE INDEX idx_ipv2_ksi_no ON import_product_v2 (ksi_no);
CREATE INDEX idx_ipv2_ptype ON import_product_v2 (ptype);
CREATE INDEX idx_ipv2_ctype ON import_product_v2 (ctype);
CREATE INDEX idx_ipv2_make ON import_product_v2 (make);
CREATE INDEX idx_ipv2_model ON import_product_v2 (model);
CREATE INDEX idx_ipv2_quote_only ON import_product_v2 (is_quote_only);

COMMIT;

-- =============================================================================
-- Summary stats
-- =============================================================================
\echo ''
\echo '=== import_product_v2 Summary ==='

SELECT count(*) AS total_rows FROM import_product_v2;

SELECT
  count(DISTINCT base_plink) AS unique_products,
  count(DISTINCT base_plink) FILTER (WHERE has_ksi)        AS with_ksi_price,
  count(DISTINCT base_plink) FILTER (WHERE is_quote_only)  AS quote_only,
  count(DISTINCT plink)      FILTER (WHERE link_suffix IS NOT NULL AND link_suffix != '') AS certified_variants
FROM import_product_v2;

SELECT
  count(DISTINCT make) AS makes,
  count(DISTINCT model) AS models,
  min(y1::int) FILTER (WHERE y1 ~ '^\d{4}$') AS min_year,
  max(y2::int) FILTER (WHERE y2 ~ '^\d{4}$' AND y2::int < 9999) AS max_year
FROM import_product_v2;

\echo ''
\echo 'Top 10 categories:'
SELECT pt.ctype, ct.cname, count(DISTINCT ipv2.base_plink) AS products
FROM import_product_v2 ipv2
JOIN partslink_ptype pt ON pt.ptype = ipv2.ptype
JOIN partslink_ctype ct ON ct.ctype = pt.ctype
GROUP BY pt.ctype, ct.cname
ORDER BY products DESC
LIMIT 10;
