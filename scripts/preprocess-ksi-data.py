#!/usr/bin/env python3
"""
Preprocess KSI Excel data for Medusa import.

This script:
1. Reads the KSI Excel file
2. Extracts PTYPE from Partslink numbers
3. Groups products by Partslink number
4. Identifies CAPA variants (C suffix)
5. Outputs preprocessed JSON for the Medusa import script

Usage:
    python3 /root/my-medusa-store/scripts/preprocess-ksi-data.py

Output:
    /tmp/ksi-products.json
"""

import json
import re
import pandas as pd
import numpy as np
from collections import defaultdict


class NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types."""
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

# Input/output paths
INPUT_FILE = "/root/data/ksi_item.xlsx"
OUTPUT_FILE = "/tmp/ksi-products.json"

def extract_ptype(plink: str) -> str | None:
    """Extract 4-digit PTYPE from Partslink number.

    Format: [MFG_CODE 2 chars][PTYPE 4 digits][SEQUENCE 2-3 digits][SUFFIX optional]
    Example: HO1236102 -> 1236, AC3010114C -> 3010
    """
    if not plink or pd.isna(plink):
        return None
    match = re.match(r'^([A-Z]{2})(\d{4})(\d{2,3})([A-Z]?)$', str(plink).strip())
    if match:
        return match.group(2)
    return None


def get_base_partslink(plink: str) -> str | None:
    """Get base Partslink number without suffix.

    Example: HO1236102C -> HO1236102
    """
    if not plink or pd.isna(plink):
        return None
    match = re.match(r'^([A-Z]{2})(\d{4})(\d{2,3})([A-Z]?)$', str(plink).strip())
    if match:
        return match.group(1) + match.group(2) + match.group(3)
    return None


def get_suffix(plink: str) -> str | None:
    """Get suffix from Partslink number.

    Example: HO1236102C -> C
    """
    if not plink or pd.isna(plink):
        return None
    match = re.match(r'^([A-Z]{2})(\d{4})(\d{2,3})([A-Z]?)$', str(plink).strip())
    if match and match.group(4):
        return match.group(4)
    return None


def main():
    print(f"Reading {INPUT_FILE}...")
    df = pd.read_excel(INPUT_FILE)
    print(f"Loaded {len(df):,} rows")

    # Add derived columns
    df['ptype'] = df['link_no'].apply(extract_ptype)
    df['base_partslink'] = df['link_no'].apply(get_base_partslink)
    df['suffix'] = df['link_no'].apply(get_suffix)

    # Stats
    total_rows = len(df)
    with_ptype = df['ptype'].notna().sum()
    missing_ptype = df['ptype'].isna().sum()
    capa_count = (df['suffix'] == 'C').sum()

    print(f"\nStats:")
    print(f"  Total rows: {total_rows:,}")
    print(f"  With PTYPE: {with_ptype:,} ({with_ptype/total_rows*100:.1f}%)")
    print(f"  Missing PTYPE: {missing_ptype:,}")
    print(f"  CAPA variants (C suffix): {capa_count:,}")

    # Group by Partslink number
    # Each product can have multiple fitments (make/model/year combinations)
    products_dict = defaultdict(lambda: {
        'ksi_nos': [],
        'partslink_no': None,
        'base_partslink': None,
        'suffix': None,
        'ptype': None,
        'hollander_no': None,
        'part_desc': None,
        'price': 0,
        'qty': 0,
        'fitments': []
    })

    for _, row in df.iterrows():
        plink = row['link_no']
        if not plink or pd.isna(plink):
            continue

        plink = str(plink).strip()
        product = products_dict[plink]

        # Set product info (from first occurrence)
        if product['partslink_no'] is None:
            product['partslink_no'] = plink
            product['base_partslink'] = row['base_partslink'] if pd.notna(row['base_partslink']) else None
            product['suffix'] = row['suffix'] if pd.notna(row['suffix']) else None
            product['ptype'] = row['ptype'] if pd.notna(row['ptype']) else None
            product['hollander_no'] = row['hollander_no'] if not pd.isna(row.get('hollander_no')) else None
            product['part_desc'] = row['part_desc'] if not pd.isna(row.get('part_desc')) else plink
            product['price'] = float(row['price']) if not pd.isna(row.get('price')) else 0
            # Handle qty that might have + suffix like "5+"
            qty_val = row.get('qty')
            if pd.isna(qty_val):
                product['qty'] = 0
            else:
                qty_str = str(qty_val).replace('+', '').strip()
                try:
                    product['qty'] = int(float(qty_str))
                except (ValueError, TypeError):
                    product['qty'] = 0

        # Add KSI number
        ksi_no = row['KSI_no']
        if ksi_no and not pd.isna(ksi_no):
            product['ksi_nos'].append(str(ksi_no))

        # Add fitment
        make = row['maker_desc']
        model = row['model_desc']
        year_from = row['year_from']
        year_to = row['year_to']

        if make and not pd.isna(make) and model and not pd.isna(model):
            # Check if this fitment already exists
            fitment_key = (str(make), str(model), int(year_from) if not pd.isna(year_from) else 0, int(year_to) if not pd.isna(year_to) else 0)
            existing = [f for f in product['fitments'] if (f['make'], f['model'], f['year_from'], f['year_to']) == fitment_key]

            if not existing:
                product['fitments'].append({
                    'make': str(make).strip(),
                    'model': str(model).strip(),
                    'year_from': int(year_from) if not pd.isna(year_from) else 0,
                    'year_to': int(year_to) if not pd.isna(year_to) else int(year_from) if not pd.isna(year_from) else 0,
                })

    # Convert to list and clean up
    products = []
    for plink, product in products_dict.items():
        # Use first KSI number as primary
        product['ksi_no'] = product['ksi_nos'][0] if product['ksi_nos'] else None
        del product['ksi_nos']
        products.append(product)

    print(f"\nProcessed {len(products):,} unique products")

    # Count CAPA variants with matching base
    base_plinks = set(p['partslink_no'] for p in products if not p['suffix'])
    capa_with_base = sum(1 for p in products if p['suffix'] == 'C' and p['base_partslink'] in base_plinks)
    capa_without_base = sum(1 for p in products if p['suffix'] == 'C' and p['base_partslink'] not in base_plinks)

    print(f"  CAPA with matching base: {capa_with_base:,}")
    print(f"  CAPA without matching base: {capa_without_base:,}")

    # Prepare output
    output = {
        'products': products,
        'stats': {
            'total_rows': total_rows,
            'unique_products': len(products),
            'capa_variants': capa_count,
            'missing_ptype': missing_ptype,
        }
    }

    # Write output
    print(f"\nWriting to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, cls=NumpyEncoder)

    # Get file size
    import os
    file_size = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"Done! Output size: {file_size:.1f} MB")

    # Show sample
    print("\nSample products:")
    for p in products[:3]:
        print(f"  {p['partslink_no']}: {p['part_desc'][:50]}... ({len(p['fitments'])} fitments)")


if __name__ == '__main__':
    main()
